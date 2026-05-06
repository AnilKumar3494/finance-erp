import hashlib
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from botocore.exceptions import ClientError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.models.customer import Customer
from app.models.document import DocCategory, Document
from app.models.user import User, UserRole
from app.models.loan import Loan
from app.models.transaction import Transaction
from app.models.vehicle import Vehicle
from app.utils.s3 import (
    archive_file_in_s3,
    delete_file_from_s3,
    generate_presigned_url,
    upload_file_to_s3,
)

logger = logging.getLogger(__name__)

# Prefix constants
ACTIVE_PREFIX = "customers/"
ARCHIVE_PREFIX = "archives/"


# --------------------------------------------------
# READ HELPERS
# --------------------------------------------------
def get_document(db: Session, document_id: uuid.UUID) -> Optional[Document]:
    """Fetch single active document by ID, eager-load uploader."""
    return (
        db.query(Document)
        .options(joinedload(Document.uploaded_by))
        .filter(Document.id == document_id, Document.is_deleted == False)
        .first()
    )


def get_document_including_deleted(
    db: Session, document_id: uuid.UUID
) -> Optional[Document]:
    """Used by restore — fetch even if soft-deleted."""
    return (
        db.query(Document)
        .options(joinedload(Document.uploaded_by))
        .filter(Document.id == document_id)
        .first()
    )


def list_documents(
    db: Session,
    requesting_user: User,
    customer_id: Optional[uuid.UUID] = None,
    doc_type: Optional[DocCategory] = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Document], int]:
    """
    ADMIN/SUPER_ADMIN → sees all documents
    EMPLOYEE → only sees documents of their assigned customers
    Eager-loads uploader to avoid N+1. Resolves §2.1.
    """
    query = (
        db.query(Document)
        .options(joinedload(Document.uploaded_by))
        .filter(Document.is_deleted == False)
    )

    if requesting_user.role == UserRole.EMPLOYEE:
        query = query.join(Customer, Customer.id == Document.customer_id).filter(
            Customer.assigned_employee_id == requesting_user.id
        )

    if customer_id:
        query = query.filter(Document.customer_id == customer_id)

    if doc_type:
        query = query.filter(Document.doc_type == doc_type)

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
    """
    if requesting_user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        return True

    customer = db.query(Customer).filter(Customer.id == document.customer_id).first()
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
) -> Document:
    customer = (
        db.query(Customer)
        .filter(Customer.id == customer_id, Customer.is_deleted == False)
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

    if doc_type == DocCategory.LOAN_AGREEMENT:
        if not loan_id:
            raise ValueError("loan_id is required for LOAN_AGREEMENT documents")
        loan = (
            db.query(Loan)
            .filter(
                Loan.id == loan_id,
                Loan.customer_id == customer_id,
                Loan.is_deleted == False,
            )
            .first()
        )
        if not loan:
            raise ValueError("Loan not found or does not belong to this customer")

    elif doc_type == DocCategory.RECEIPT:
        if not transaction_id:
            raise ValueError("transaction_id is required for RECEIPT documents")
        txn = (
            db.query(Transaction)
            .join(Loan, Loan.id == Transaction.loan_id)
            .filter(
                Transaction.id == transaction_id,
                Loan.customer_id == customer_id,
                Transaction.is_deleted == False,
            )
            .first()
        )
        if not txn:
            raise ValueError(
                "Transaction not found or does not belong to this customer"
            )

    elif doc_type == DocCategory.VEHICLE_IMAGE:
        if not vehicle_id:
            raise ValueError("vehicle_id is required for VEHICLE_IMAGE documents")
        vehicle = (
            db.query(Vehicle)
            .filter(
                Vehicle.id == vehicle_id,
                Vehicle.is_deleted == False,
            )
            .first()
        )
        if not vehicle:
            raise ValueError("Vehicle not found")

    elif doc_type == DocCategory.KYC:
        if loan_id or transaction_id or vehicle_id:
            raise ValueError(
                "KYC documents must not have loan_id, transaction_id, or vehicle_id"
            )

    file_hash = hashlib.sha256(file_bytes).hexdigest()

    # fallback if name is all special chars
    safe_name = customer.full_name.replace(" ", "_").lower()
    safe_name = "".join(c for c in safe_name if c.isalnum() or c == "_") or "customer"

    save_file_name = Path(file_name).name  # strips any path components
    s3_key = (
        f"{ACTIVE_PREFIX}{safe_name}_{str(customer_id)[:8]}/"
        f"{doc_type.value}/{uuid.uuid4()}/{save_file_name}"
    )

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
        db.commit()
        db.refresh(document)
        return document

    except IntegrityError:
        db.rollback()
        if s3_uploaded:
            try:
                delete_file_from_s3(s3_key)
            except Exception:
                logger.exception("ORPHAN S3 KEY %s after dup-rollback", s3_key)
        raise ValueError("Duplicate file already uploaded")

    except SQLAlchemyError:
        db.rollback()
        if s3_uploaded:
            try:
                delete_file_from_s3(s3_key)
            except Exception:
                logger.exception("ORPHAN S3 KEY %s after sql-rollback", s3_key)
        logger.exception("upload_document DB error for customer %s", customer_id)
        raise ValueError("Database save failed")


# --------------------------------------------------
# DOWNLOAD URL
# --------------------------------------------------
def get_download_url(document: Document) -> str:
    # AKTODO: once antivirus is wired, refuse if document.scan_status != CLEAN.
    return generate_presigned_url(document.s3_key, file_name=document.file_name)


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
def soft_delete_document(
    db: Session, document: Document, deleted_by: uuid.UUID
) -> Document:
    if not document.s3_key.startswith(ACTIVE_PREFIX):
        raise ValueError(
            f"Cannot archive — key not in active prefix: {document.s3_key}"
        )

    old_s3_key = document.s3_key
    new_s3_key = ARCHIVE_PREFIX + old_s3_key[len(ACTIVE_PREFIX) :]

    document.s3_key = new_s3_key
    document.is_deleted = True
    document.deleted_at = datetime.now(timezone.utc)
    document.deleted_by_id = deleted_by
    document.updated_by_id = deleted_by

    try:
        db.flush()
        archive_file_in_s3(old_s3_key, new_s3_key)
        db.commit()
        db.refresh(document)
        return document
    except (SQLAlchemyError, ClientError, ValueError) as e:
        logger.exception("soft_delete_document failed for doc %s", document.id)
        db.rollback()
        # Compensate: try to put the file back if S3 archive succeeded
        try:
            archive_file_in_s3(new_s3_key, old_s3_key)
        except Exception:
            logger.exception("ORPHAN S3 KEY %s after soft-delete rollback", new_s3_key)
        raise ValueError(f"Archive failed: {e}")


# --------------------------------------------------
# RESTORE
# --------------------------------------------------
def restore_document(
    db: Session, document: Document, restored_by: uuid.UUID
) -> Document:
    if not document.s3_key.startswith(ARCHIVE_PREFIX):
        raise ValueError(
            f"Document S3 key not in archive prefix — cannot restore. "
            f"Key: {document.s3_key}"
        )

    old_s3_key = document.s3_key
    new_s3_key = ACTIVE_PREFIX + old_s3_key[len(ARCHIVE_PREFIX) :]

    document.s3_key = new_s3_key
    document.is_deleted = False
    document.deleted_at = None
    document.deleted_by_id = None
    document.updated_by_id = restored_by

    try:
        db.flush()
        archive_file_in_s3(old_s3_key, new_s3_key)
        db.commit()
        db.refresh(document)
        return document
    except (SQLAlchemyError, ClientError, ValueError) as e:
        logger.exception("restore_document failed for doc %s", document.id)
        db.rollback()
        try:
            archive_file_in_s3(new_s3_key, old_s3_key)
        except Exception:
            logger.exception("ORPHAN S3 KEY %s after restore rollback", new_s3_key)
        raise ValueError(f"Restore failed: {e}")


### AKTODO: For listing soft deleted files GET /documents/?include_deleted=true
