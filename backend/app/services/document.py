import hashlib
import logging
import uuid
from pathlib import Path
from typing import Optional

from botocore.exceptions import ClientError
from fastapi import Request
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.models.customer import Customer
from app.models.document import DocCategory, Document
from app.models.loan import Loan
from app.models.transaction import Transaction
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.utils.audit import write_audit
from app.utils.db_errors import safe_integrity_message
from app.utils.s3 import (
    archive_file_in_s3,
    delete_file_from_s3,
    generate_presigned_url,
    upload_file_to_s3,
)

logger = logging.getLogger(__name__)

# Prefix constants — single source of truth for S3 layout.
ACTIVE_PREFIX = "customers/"
ARCHIVE_PREFIX = "archives/"

# doc_types that REQUIRE a vehicle link and forbid loan/transaction links.
# VEHICLE_IMAGE was collapsed into VEHICLE_PHOTO by migration 012 — they
# meant the same thing; keeping both forced every reader to know that.
_VEHICLE_LINKED = frozenset(
    {
        DocCategory.RC_COPY,
        DocCategory.INSURANCE_POLICY,
        DocCategory.VEHICLE_PHOTO,
    }
)

# doc_types that REQUIRE a loan link.
_LOAN_LINKED = frozenset(
    {DocCategory.LOAN_AGREEMENT, DocCategory.STABILITY_DOC}
)

# doc_types that must be UNLINKED to loan/transaction/vehicle. These are
# customer-owned records, not artefacts of one finance.
_UNLINKED = frozenset({DocCategory.KYC, DocCategory.IDENTITY_PROOF})


# --------------------------------------------------
# LINK VALIDATION — single source of truth for every doc_type
# --------------------------------------------------
def _validate_links(
    db: Session,
    *,
    doc_type: DocCategory,
    customer_id: uuid.UUID,
    loan_id: Optional[uuid.UUID],
    transaction_id: Optional[uuid.UUID],
    vehicle_id: Optional[uuid.UUID],
) -> None:
    """Verify the (loan_id, transaction_id, vehicle_id) tuple is consistent
    with doc_type, and that each referenced row exists and belongs to the
    customer. Raises ValueError on any mismatch — caller maps to 400.

    Mirrors the DB CHECK `ck_documents_type_link_consistency` so violations
    surface as a clean validation error instead of a generic IntegrityError
    that gets misreported as a duplicate.
    """
    # --- LOAN_AGREEMENT / STABILITY_DOC: require loan_id, forbid txn/vehicle.
    if doc_type in _LOAN_LINKED:
        if not loan_id:
            raise ValueError(
                f"loan_id is required for {doc_type.value} documents"
            )
        if transaction_id or vehicle_id:
            raise ValueError(
                f"{doc_type.value} documents must not have "
                "transaction_id or vehicle_id"
            )
        loan = (
            db.query(Loan)
            .filter(
                Loan.id == loan_id,
                Loan.customer_id == customer_id,
                Loan.is_deleted == False,  # noqa: E712
            )
            .first()
        )
        if not loan:
            raise ValueError("Loan not found or does not belong to this customer")
        return

    # --- RECEIPT: require transaction_id (which must belong to a loan of
    # this customer), forbid loan_id/vehicle_id.
    if doc_type == DocCategory.RECEIPT:
        if not transaction_id:
            raise ValueError("transaction_id is required for RECEIPT documents")
        if loan_id or vehicle_id:
            raise ValueError(
                "RECEIPT documents must not have loan_id or vehicle_id"
            )
        txn = (
            db.query(Transaction)
            .join(Loan, Loan.id == Transaction.loan_id)
            .filter(
                Transaction.id == transaction_id,
                Loan.customer_id == customer_id,
                Transaction.is_deleted == False,  # noqa: E712
            )
            .first()
        )
        if not txn:
            raise ValueError(
                "Transaction not found or does not belong to this customer"
            )
        return

    # --- Vehicle docs: require vehicle_id, forbid loan/transaction.
    # Vehicles have no direct customer ownership — they're collateral and
    # belong to a customer transitively, via loans.vehicle_id. Without
    # this cross-check the vehicle-doc lane is a cross-tenant leak:
    # customer A could upload an RC scan for a vehicle backing customer
    # B's loan. Require an active, non-deleted loan that pairs the
    # provided vehicle_id with customer_id.
    if doc_type in _VEHICLE_LINKED:
        if not vehicle_id:
            raise ValueError(
                f"vehicle_id is required for {doc_type.value} documents"
            )
        if loan_id or transaction_id:
            raise ValueError(
                f"{doc_type.value} documents must not have "
                "loan_id or transaction_id"
            )
        vehicle = (
            db.query(Vehicle)
            .filter(
                Vehicle.id == vehicle_id,
                Vehicle.is_deleted == False,  # noqa: E712
            )
            .first()
        )
        if not vehicle:
            raise ValueError("Vehicle not found")

        # Cross-tenant guard: a vehicle is only "this customer's" if there
        # is a non-deleted loan tying them together. This includes loans
        # in any status (DRAFT through CLOSED) so a customer can upload
        # the RC for a vehicle on a closed loan — historical access is
        # legitimate. Deleted loans don't count.
        owns_via_loan = (
            db.query(Loan.id)
            .filter(
                Loan.customer_id == customer_id,
                Loan.vehicle_id == vehicle_id,
                Loan.is_deleted == False,  # noqa: E712
            )
            .first()
            is not None
        )
        if not owns_via_loan:
            raise ValueError(
                "Vehicle is not associated with this customer "
                "(no active loan pairs them)."
            )
        return

    # --- KYC / IDENTITY_PROOF: must not link to anything.
    if doc_type in _UNLINKED:
        if loan_id or transaction_id or vehicle_id:
            raise ValueError(
                f"{doc_type.value} documents must not have "
                "loan_id, transaction_id, or vehicle_id"
            )
        return

    # --- ARCHIVE: the catch-all bucket. A loan link is OPTIONAL — an ad-hoc
    # document may be filed against one finance ("Add other document" on the
    # finance detail page) or held at customer level with no link at all.
    # This used to forbid every link, which made that button unusable: it
    # sends loan_id, and the upload 400'd every time. Note the DB CHECK
    # `ck_documents_type_link_consistency` has always permitted this — its
    # ARCHIVE clause is unconditional — so no schema change is involved,
    # this validator was simply stricter than the constraint it mirrors.
    if doc_type == DocCategory.ARCHIVE:
        if transaction_id or vehicle_id:
            raise ValueError(
                "ARCHIVE documents must not have transaction_id or vehicle_id"
            )
        if loan_id:
            loan = (
                db.query(Loan)
                .filter(
                    Loan.id == loan_id,
                    Loan.customer_id == customer_id,
                    Loan.is_deleted == False,  # noqa: E712
                )
                .first()
            )
            if not loan:
                raise ValueError(
                    "Loan not found or does not belong to this customer"
                )
        return

    # Safety net: any future enum value will land here loudly instead of
    # silently slipping past validation into the DB CHECK.
    raise ValueError(f"Unsupported doc_type: {doc_type.value}")


# --------------------------------------------------
# READ HELPERS
# --------------------------------------------------
def get_document(db: Session, document_id: uuid.UUID) -> Optional[Document]:
    """Fetch single active document by ID, eager-load uploader + customer."""
    return (
        db.query(Document)
        .options(
            joinedload(Document.uploaded_by),
            joinedload(Document.customer),
        )
        .filter(Document.id == document_id, Document.is_deleted == False)  # noqa: E712
        .first()
    )


def get_document_including_deleted(
    db: Session, document_id: uuid.UUID
) -> Optional[Document]:
    """Used by restore — fetch even if soft-deleted."""
    return (
        db.query(Document)
        .options(
            joinedload(Document.uploaded_by),
            joinedload(Document.customer),
        )
        .filter(Document.id == document_id)
        .first()
    )


def list_documents(
    db: Session,
    requesting_user: User,
    customer_id: Optional[uuid.UUID] = None,
    doc_type: Optional[DocCategory] = None,
    loan_id: Optional[uuid.UUID] = None,
    vehicle_id: Optional[uuid.UUID] = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Document], int]:
    """
    ADMIN/SUPER_ADMIN → sees all documents
    EMPLOYEE → only sees documents of their assigned customers
    Eager-loads uploader to avoid N+1.
    """
    query = (
        db.query(Document)
        .options(joinedload(Document.uploaded_by))
        .filter(Document.is_deleted == False)  # noqa: E712
    )

    if requesting_user.role == UserRole.EMPLOYEE:
        query = query.join(Customer, Customer.id == Document.customer_id).filter(
            Customer.assigned_employee_id == requesting_user.id
        )

    if customer_id:
        query = query.filter(Document.customer_id == customer_id)
    if doc_type:
        query = query.filter(Document.doc_type == doc_type)
    if loan_id:
        query = query.filter(Document.loan_id == loan_id)
    if vehicle_id:
        query = query.filter(Document.vehicle_id == vehicle_id)

    total = query.count()
    results = (
        query.order_by(Document.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return results, total


def check_document_access(
    document: Document, requesting_user: User, db: Session
) -> bool:
    """
    Admin/Super-admin → always yes.
    Employee → only if assigned to the document's customer.
    Uses the eager-loaded `document.customer` when available to avoid an
    extra round-trip; falls back to a query only if needed.
    """
    if requesting_user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        return True

    customer = document.customer
    if customer is None:
        customer = (
            db.query(Customer)
            .filter(Customer.id == document.customer_id)
            .first()
        )
    return customer is not None and customer.assigned_employee_id == requesting_user.id


# --------------------------------------------------
# UPLOAD
# --------------------------------------------------
def upload_document(
    db: Session,
    requesting_user: User,
    customer_id: uuid.UUID,
    doc_type: DocCategory,
    file_bytes: bytes,
    file_name: str,
    content_type: str,
    created_by: uuid.UUID,
    loan_id: Optional[uuid.UUID] = None,
    transaction_id: Optional[uuid.UUID] = None,
    vehicle_id: Optional[uuid.UUID] = None,
    request: Optional[Request] = None,
) -> Document:
    customer = (
        db.query(Customer)
        .filter(Customer.id == customer_id, Customer.is_deleted == False)  # noqa: E712
        .first()
    )
    if not customer:
        raise ValueError("Customer not found")

    # Employee can only upload to assigned customer
    if (
        requesting_user.role == UserRole.EMPLOYEE
        and customer.assigned_employee_id != requesting_user.id
    ):
        raise PermissionError("Customer not assigned to you")

    # Single dispatch over every doc_type — D1/D2 fix.
    _validate_links(
        db,
        doc_type=doc_type,
        customer_id=customer_id,
        loan_id=loan_id,
        transaction_id=transaction_id,
        vehicle_id=vehicle_id,
    )

    file_hash = hashlib.sha256(file_bytes).hexdigest()

    # Check for a same-purpose duplicate BEFORE the S3 PutObject. The partial
    # unique index (migration 023) is still the authority, but reaching it
    # means we have already paid for an upload we then have to delete, and
    # the IntegrityError only yields a generic message. Catching it here is
    # cheaper and lets us say exactly what collided.
    duplicate = (
        db.query(Document)
        .filter(
            Document.customer_id == customer_id,
            Document.doc_type == doc_type,
            Document.file_hash == file_hash,
            Document.is_deleted == False,  # noqa: E712
        )
        .first()
    )
    if duplicate:
        raise ValueError(
            "This exact file has already been uploaded for this document "
            "type. Upload a different file, or delete the existing one first."
        )

    # fallback if name is all special chars
    safe_name = customer.full_name.replace(" ", "_").lower()
    safe_name = "".join(c for c in safe_name if c.isalnum() or c == "_") or "customer"

    save_file_name = Path(file_name).name  # strips any path components
    s3_key = (
        f"{ACTIVE_PREFIX}{safe_name}_{str(customer_id)[:8]}/"
        f"{doc_type.value}/{uuid.uuid4()}/{save_file_name}"
    )

    # S3 upload BEFORE the DB write. If S3 fails we never opened a DB
    # transaction; if the DB write fails we rollback + delete the S3
    # object so we never leak an orphan file.
    s3_uploaded = False
    try:
        upload_file_to_s3(
            file_bytes=file_bytes, s3_key=s3_key, content_type=content_type
        )
        s3_uploaded = True

        document = Document(
            customer_id=customer_id,
            loan_id=loan_id,
            transaction_id=transaction_id,
            vehicle_id=vehicle_id,
            doc_type=doc_type,
            s3_key=s3_key,
            file_name=save_file_name,
            content_type=content_type,
            file_size=len(file_bytes),
            file_hash=file_hash,
            created_by_id=created_by,
            # AKTODO: set scan_status='PENDING' once antivirus pipeline is wired up.
        )
        db.add(document)
        # Atomic commit: flush surfaces IntegrityError without committing,
        # then write_audit lands the audit row in the same transaction,
        # then a single commit persists both. The old pattern (commit
        # in service + audit in route) could leave a committed doc
        # without an audit row if the worker crashed between them.
        db.flush()
        write_audit(
            db,
            action_type="DOCUMENT_UPLOAD",
            target_table="documents",
            record_id=document.id,
            user_id=created_by,
            new_data={
                "customer_id": str(document.customer_id),
                "doc_type": document.doc_type.value,
                "loan_id": str(document.loan_id) if document.loan_id else None,
                "transaction_id": (
                    str(document.transaction_id) if document.transaction_id else None
                ),
                "vehicle_id": str(document.vehicle_id) if document.vehicle_id else None,
                "file_size": document.file_size,
                "content_type": document.content_type,
            },
            request=request,
        )
        db.commit()
        db.refresh(document)
        return document

    except IntegrityError as e:
        db.rollback()
        if s3_uploaded:
            try:
                delete_file_from_s3(s3_key)
            except Exception:
                logger.exception("ORPHAN_S3_KEY key=%s after dup-rollback", s3_key)
        # Use the generic non-leaking message — duplicate-by-hash is the
        # most likely cause given the partial unique index, but the route
        # layer can decide how to format the response.
        raise ValueError(safe_integrity_message(e)) from None

    except SQLAlchemyError:
        db.rollback()
        if s3_uploaded:
            try:
                delete_file_from_s3(s3_key)
            except Exception:
                logger.exception("ORPHAN_S3_KEY key=%s after sql-rollback", s3_key)
        logger.exception("upload_document DB error for customer %s", customer_id)
        raise ValueError("Database save failed")


# --------------------------------------------------
# UPDATE METADATA
# --------------------------------------------------
def update_document_metadata(
    db: Session,
    document: Document,
    *,
    doc_type: Optional[DocCategory] = None,
    file_name: Optional[str] = None,
    updated_by: uuid.UUID,
    request: Optional[Request] = None,
) -> Document:
    """Update mutable metadata. If doc_type changes, re-run the link
    validation against the document's existing FK columns so we don't end
    up with a row that violates `ck_documents_type_link_consistency`.
    """
    before = {
        "doc_type": document.doc_type.value,
        "file_name": document.file_name,
    }

    if doc_type is not None and doc_type != document.doc_type:
        _validate_links(
            db,
            doc_type=doc_type,
            customer_id=document.customer_id,
            loan_id=document.loan_id,
            transaction_id=document.transaction_id,
            vehicle_id=document.vehicle_id,
        )
        document.doc_type = doc_type

    if file_name is not None:
        document.file_name = Path(file_name).name  # strip path components

    document.updated_by_id = updated_by

    try:
        db.flush()
        write_audit(
            db,
            action_type="DOCUMENT_UPDATE",
            target_table="documents",
            record_id=document.id,
            user_id=updated_by,
            old_data=before,
            new_data={
                "doc_type": document.doc_type.value,
                "file_name": document.file_name,
            },
            request=request,
        )
        db.commit()
        db.refresh(document)
        return document
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e)) from None


# --------------------------------------------------
# DOWNLOAD URL
# --------------------------------------------------
def get_download_url(document: Document) -> str:
    # AKTODO: once antivirus is wired, refuse if document.scan_status != CLEAN.
    return generate_presigned_url(document.s3_key, file_name=document.file_name)


def issue_download(
    db: Session,
    document: Document,
    *,
    requested_by: uuid.UUID,
    request: Optional[Request] = None,
) -> str:
    """Issue a presigned URL AND record the audit row in one commit.

    The route was previously: generate URL → write_audit → commit. If
    the worker crashed between url-generation and commit, the URL was
    handed to the client but the audit row never landed. Here the audit
    write is mandatory before the function returns the URL.
    """
    url = generate_presigned_url(document.s3_key, file_name=document.file_name)
    write_audit(
        db,
        action_type="DOCUMENT_DOWNLOAD",
        target_table="documents",
        record_id=document.id,
        user_id=requested_by,
        new_data={
            "doc_type": document.doc_type.value,
            "customer_id": str(document.customer_id),
            "file_name": document.file_name,
        },
        request=request,
    )
    db.commit()
    return url


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
def soft_delete_document(
    db: Session,
    document: Document,
    deleted_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> Document:
    if not document.s3_key.startswith(ACTIVE_PREFIX):
        raise ValueError(
            f"Cannot archive — key not in active prefix: {document.s3_key}"
        )

    snapshot = {
        "doc_type": document.doc_type.value,
        "customer_id": str(document.customer_id),
        "file_name": document.file_name,
    }
    old_s3_key = document.s3_key
    new_s3_key = ARCHIVE_PREFIX + old_s3_key[len(ACTIVE_PREFIX):]

    document.s3_key = new_s3_key
    # Centralized soft-delete: keeps is_deleted/deleted_at in sync (satisfies
    # check_soft_delete_documents) and stamps updated_by_id.
    document.soft_delete(deleted_by)

    try:
        db.flush()
        archive_file_in_s3(old_s3_key, new_s3_key)
        write_audit(
            db,
            action_type="DOCUMENT_DELETE",
            target_table="documents",
            record_id=document.id,
            user_id=deleted_by,
            old_data=snapshot,
            request=request,
        )
        db.commit()
        db.refresh(document)
        return document
    except (SQLAlchemyError, ClientError, ValueError) as e:
        logger.exception("soft_delete_document failed for doc %s", document.id)
        db.rollback()
        # Compensate: try to put the file back if S3 archive succeeded.
        # On failure we MUST log the orphan key — a human or janitor sweep
        # is the only recovery path.
        try:
            archive_file_in_s3(new_s3_key, old_s3_key)
        except Exception:
            logger.error(
                "ORPHAN_S3_KEY key=%s doc_id=%s phase=soft_delete_rollback",
                new_s3_key,
                document.id,
            )
        raise ValueError(f"Archive failed: {e}")


# --------------------------------------------------
# RESTORE
# --------------------------------------------------
def restore_document(
    db: Session,
    document: Document,
    restored_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> Document:
    if not document.s3_key.startswith(ARCHIVE_PREFIX):
        raise ValueError(
            f"Document S3 key not in archive prefix — cannot restore. "
            f"Key: {document.s3_key}"
        )

    old_s3_key = document.s3_key
    new_s3_key = ACTIVE_PREFIX + old_s3_key[len(ARCHIVE_PREFIX):]

    document.s3_key = new_s3_key
    document.restore(restored_by)

    try:
        db.flush()
        archive_file_in_s3(old_s3_key, new_s3_key)
        write_audit(
            db,
            action_type="DOCUMENT_RESTORE",
            target_table="documents",
            record_id=document.id,
            user_id=restored_by,
            new_data={
                "doc_type": document.doc_type.value,
                "file_name": document.file_name,
            },
            request=request,
        )
        db.commit()
        db.refresh(document)
        return document
    except (SQLAlchemyError, ClientError, ValueError) as e:
        logger.exception("restore_document failed for doc %s", document.id)
        db.rollback()
        try:
            archive_file_in_s3(new_s3_key, old_s3_key)
        except Exception:
            logger.error(
                "ORPHAN_S3_KEY key=%s doc_id=%s phase=restore_rollback",
                new_s3_key,
                document.id,
            )
        raise ValueError(f"Restore failed: {e}")


### AKTODO: For listing soft deleted files GET /documents/?include_deleted=true
