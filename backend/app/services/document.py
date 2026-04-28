import os
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.models.customer import Customer
from app.models.document import DocCategory, Document
from app.models.user import User, UserRole
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
    request_user: User,
    customer_id: Optional[uuid.UUID] = None,
    doc_type: Optional[DocCategory] = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Document], int]:
    """
    ADMIN → sees all documents
    EMPLOYEE → only sees documents of their assigned customers
    """
    query = db.query(Document).filter(Document.is_deleted == False)

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
    Returns True if user can access this document.
    Admin → always yes.
    Employee → only if they are assigned to the customer.
    """
    if requesting_user.role == UserRole.ADMIN:
        return True

    customer = db.query(Customer).filter(Customer.id == document.customer_id).first()

    return customer is not None and customer.assigned_employee_id == requesting_user.id


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

    customer = (
        db.query(Customer)
        .filter(Customer.id == customer_id, Customer.is_deleted == False)
        .first()
    )

    if not customer:
        raise ValueError("Customer not found")

    save_file_name = os.path.basename(file_name)

    # Build a unique S3 key
    s3_key = f"customers/{customer_id}/{doc_type}/{uuid.uuid4()}/{save_file_name}"

    # Upload to S3 first
    upload_file_to_s3(file_bytes=file_bytes, s3_key=s3_key, content_type=content_type)

    # Save metadata to DB
    document = Document(
        customer_id=customer_id,
        doc_type=doc_type,
        s3_key=s3_key,
        file_name=save_file_name,
        content_type=content_type,
        file_size=len(file_bytes),
        created_by_id=created_by,
    )
    db.add(document)

    try:
        db.commit()
        db.refresh(document)
        return document

    except Exception:
        db.rollback()
        delete_file_from_s3(s3_key)
        raise ValueError("Upload failed while saving document")


def get_download_url(document: Document) -> str:
    """Generate a pre-signed URL for downloading"""
    return generate_presigned_url(document.s3_key)


def enrich_document(document: Document, db: Session) -> dict:
    """
    Attach uploaded_by_name to document response.
    Avoids lazy loading issues.
    """
    uploader = db.query(User).filter(User.id == document.created_by_id).first()

    # Convert SQLAlchemy object to dict safely
    doc_dict = {c.key: getattr(document, c.key) for c in document.__table__.columns}

    doc_dict["uploaded_by_name"] = uploader.full_name if uploader else None

    return doc_dict


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
