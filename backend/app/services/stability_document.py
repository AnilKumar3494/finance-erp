import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.stability_document import StabilityDocument
from app.schemas.stability_document import StabilityDocumentCreate


def create_stability_document(
    db: Session,
    loan_id: uuid.UUID,
    data: StabilityDocumentCreate,
    created_by: uuid.UUID,
) -> StabilityDocument:
    doc = StabilityDocument(
        loan_id=loan_id,
        doc_subtype=data.doc_subtype,
        description=data.description,
        cheque_count=data.cheque_count,
        document_id=data.document_id,
        created_by_id=created_by,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def get_stability_document(
    db: Session, doc_id: uuid.UUID
) -> Optional[StabilityDocument]:
    return (
        db.query(StabilityDocument)
        .filter(StabilityDocument.id == doc_id, StabilityDocument.is_deleted == False)
        .first()
    )


def list_stability_documents(
    db: Session, loan_id: uuid.UUID
) -> list[StabilityDocument]:
    return (
        db.query(StabilityDocument)
        .filter(
            StabilityDocument.loan_id == loan_id,
            StabilityDocument.is_deleted == False,
        )
        .order_by(StabilityDocument.created_at)
        .all()
    )


def delete_stability_document(
    db: Session, doc: StabilityDocument, deleted_by: uuid.UUID
) -> None:
    doc.is_deleted = True
    doc.deleted_at = datetime.now(timezone.utc)
    doc.deleted_by_id = deleted_by
    db.commit()
