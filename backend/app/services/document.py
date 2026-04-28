import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.models.document import DocCategory, Document
from app.utils.s3 import delete_file_from_s3, generate_presigned_url, upload_file_to_s3


def get_document(db: Session, document_id: uuid.UUID) -> Optional[Document]:
    """Fetch single active document by ID"""
    return (
        db.query(Document)
        .filter(Document.id == document_id, Document.is_deleted == False)
        .first()
    )


def list_documents(
    db: Session,
    customer_id: Optional[uuid.UUID] = None,
    doc_type: Optional[DocCategory] = None,
) -> tuple[list[Document], int]:
    """List documents with optional filters"""
    query = db.query(Document).filter(Document.is_deleted == False)

    if customer_id:
        query = query.filter(Document.customer_id == customer_id)

    if doc_type:
        query = query.filter(Document.doc_type == doc_type)

    total = query.count()
    results = query.order_by(Document.created_at.desc()).all()

    return results, total


def upload_document(
    db: Session,
    customer_id: uuid.UUID,
    doc_type: DocCategory,
    file_bytes: bytes,
    file_name: str,
    content_type: str,
    created_by: uuid.UUID,
) -> Document:
    """
    Upload file to S3 then save metadata to DB.
    S3 key format: customers/{customer_id}/{doc_type}/{uuid}/{filename}
    """
    # Build a unique S3 key
    s3_key = f"customers/{customer_id}/{doc_type}/{uuid.uuid4()}/{file_name}"

    # Upload to S3 first
    upload_file_to_s3(file_bytes=file_bytes, s3_key=s3_key, content_type=content_type)

    # Save metadata to DB
    document = Document(
        customer_id=customer_id,
        doc_type=doc_type,
        s3_key=s3_key,
        file_name=file_name,
        content_type=content_type,
        created_by_id=created_by,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


def get_download_url(document: Document) -> str:
    """Generate a pre-signed URL for downloading"""
    return generate_presigned_url(document.s3_key)


def soft_delete_document(
    db: Session, document: Document, deleted_by: uuid.UUID
) -> Document:
    """Soft delete — file stays in S3, only marked deleted in DB"""
    from datetime import datetime, timezone

    document.is_deleted = True
    document.deleted_at = datetime.now(timezone.utc)
    document.updated_by_id = deleted_by
    db.commit()
    return document
