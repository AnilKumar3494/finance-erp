import uuid
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.document import DocCategory
from app.models.stability_document import StabilityDocType, StabilityDocument
from app.schemas.stability_document import (
    StabilityDocumentCreate,
    StabilityDocumentUpdate,
)
from app.utils.db_errors import safe_integrity_message
from app.utils.document_link import validate_document_link


def create_stability_document(
    db: Session,
    loan_id: uuid.UUID,
    data: StabilityDocumentCreate,
    created_by: uuid.UUID,
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
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e)) from None

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
) -> StabilityDocument:
    """Update description / cheque_count. doc_subtype is immutable.

    cheque_count rules:
      - If the row is a CHEQUE_PDC, the new value must be a positive int.
      - For any other subtype, cheque_count must stay NULL — both the
        Pydantic schema (StabilityDocumentCreate) and the DB CHECK enforce
        this; we surface it here as a clean ValueError.
    """
    changes = payload.model_dump(exclude_unset=True)

    if "description" in changes:
        doc.description = changes["description"]

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
        db.commit()
        db.refresh(doc)
        return doc
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e)) from None


def delete_stability_document(
    db: Session, doc: StabilityDocument, deleted_by: uuid.UUID
) -> None:
    # Centralized soft-delete: keeps is_deleted/deleted_at in sync (satisfies
    # the check_soft_delete_stability_docs CHECK) and also sets updated_by_id.
    doc.soft_delete(deleted_by)
    db.commit()
