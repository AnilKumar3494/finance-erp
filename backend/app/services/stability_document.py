"""
Stability Document service.

Atomicity contract (post-review):
  - Every mutation flushes within a try/except.
  - The matching audit row is written inside the SAME try block via
    `write_audit` (which uses a SAVEPOINT) BEFORE the final commit.
  - One `db.commit()` persists the mutation + audit row together.
  - On IntegrityError the rollback covers both.

This matches the personnel/customer pattern and closes the double-commit
gap CodeRabbit flagged (mutation committed before audit landed).
"""
import uuid
from typing import Optional

from fastapi import Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.document import DocCategory
from app.models.stability_document import StabilityDocType, StabilityDocument
from app.schemas.stability_document import (
    StabilityDocumentCreate,
    StabilityDocumentUpdate,
)
from app.utils.audit import write_audit
from app.utils.db_errors import safe_integrity_message
from app.utils.document_link import validate_document_link


def _audit_payload(doc: StabilityDocument) -> dict:
    """Structural facts only — never the description text (free-text)."""
    return {
        "loan_id": str(doc.loan_id),
        "doc_subtype": doc.doc_subtype.value,
        "cheque_count": doc.cheque_count,
        "has_description": doc.description is not None,
        "document_id": str(doc.document_id) if doc.document_id else None,
    }


def create_stability_document(
    db: Session,
    loan_id: uuid.UUID,
    data: StabilityDocumentCreate,
    created_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> StabilityDocument:
    # If a document is being attached, prove it is a real STABILITY_DOC
    # belonging to the same loan. Without this any UUID could be linked.
    if data.document_id is not None:
        validate_document_link(
            db,
            data.document_id,
            expected_doc_type=DocCategory.STABILITY_DOC,
            expected_loan_id=loan_id,
        )

    doc = StabilityDocument(
        loan_id=loan_id,
        doc_subtype=data.doc_subtype,
        description=data.description,
        cheque_count=data.cheque_count,
        document_id=data.document_id,
        created_by_id=created_by,
    )
    db.add(doc)
    try:
        db.flush()  # surface IntegrityError + populate doc.id
        write_audit(
            db,
            action_type="STABILITY_DOC_CREATE",
            target_table="stability_documents",
            record_id=doc.id,
            user_id=created_by,
            new_data=_audit_payload(doc),
            request=request,
        )
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e)) from None

    # Re-fetch with the nested document eager-loaded for the response.
    return (
        db.query(StabilityDocument)
        .options(joinedload(StabilityDocument.document))
        .filter(StabilityDocument.id == doc.id)
        .first()
    )


def get_stability_document(
    db: Session, doc_id: uuid.UUID
) -> Optional[StabilityDocument]:
    return (
        db.query(StabilityDocument)
        .options(joinedload(StabilityDocument.document))
        .filter(
            StabilityDocument.id == doc_id,
            StabilityDocument.is_deleted == False,  # noqa: E712
        )
        .first()
    )


def list_stability_documents(
    db: Session, loan_id: uuid.UUID
) -> list[StabilityDocument]:
    return (
        db.query(StabilityDocument)
        .options(joinedload(StabilityDocument.document))
        .filter(
            StabilityDocument.loan_id == loan_id,
            StabilityDocument.is_deleted == False,  # noqa: E712
        )
        .order_by(StabilityDocument.created_at)
        .all()
    )


def update_stability_document(
    db: Session,
    doc: StabilityDocument,
    payload: StabilityDocumentUpdate,
    *,
    updated_by: uuid.UUID,
    request: Optional[Request] = None,
) -> StabilityDocument:
    """Update description / cheque_count. doc_subtype is immutable.

    Validates the same invariants the create schema enforces:
      - CHEQUE_PDC ↔ cheque_count present and >= 1.
      - OTHER ↔ description present (CodeRabbit fix — was only on create).
    """
    before = {
        "cheque_count": doc.cheque_count,
        "had_description": doc.description is not None,
    }
    changes = payload.model_dump(exclude_unset=True)

    if "description" in changes:
        new_desc = changes["description"]
        if doc.doc_subtype == StabilityDocType.OTHER and not new_desc:
            raise ValueError(
                "description is required when doc_subtype is OTHER and "
                "cannot be cleared"
            )
        doc.description = new_desc

    if "cheque_count" in changes:
        new_count = changes["cheque_count"]
        if doc.doc_subtype != StabilityDocType.CHEQUE_PDC and new_count is not None:
            raise ValueError(
                "cheque_count is only valid when doc_subtype is CHEQUE_PDC"
            )
        if doc.doc_subtype == StabilityDocType.CHEQUE_PDC and new_count is None:
            raise ValueError(
                "cheque_count cannot be cleared on a CHEQUE_PDC stability doc"
            )
        doc.cheque_count = new_count

    doc.updated_by_id = updated_by
    try:
        db.flush()
        write_audit(
            db,
            action_type="STABILITY_DOC_UPDATE",
            target_table="stability_documents",
            record_id=doc.id,
            user_id=updated_by,
            old_data=before,
            new_data=_audit_payload(doc),
            request=request,
        )
        db.commit()
        db.refresh(doc)
        return doc
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e)) from None


def delete_stability_document(
    db: Session,
    doc: StabilityDocument,
    deleted_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> None:
    # Snapshot BEFORE soft_delete flips fields, so the audit row records
    # the row as it was before deletion.
    snapshot = _audit_payload(doc)
    # Centralized soft-delete: keeps is_deleted/deleted_at in sync (satisfies
    # the check_soft_delete_stability_docs CHECK) and also sets updated_by_id.
    doc.soft_delete(deleted_by)
    db.flush()
    write_audit(
        db,
        action_type="STABILITY_DOC_DELETE",
        target_table="stability_documents",
        record_id=doc.id,
        user_id=deleted_by,
        old_data=snapshot,
        request=request,
    )
    db.commit()
