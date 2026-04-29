import os
import uuid
import hashlib
from typing import Optional

import sqlalchemy
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from datetime import datetime, timezone

from app.models.customer import Customer
from app.models.document import DocCategory, Document
from app.models.user import User, UserRole
from app.utils.s3 import (
    archive_file_in_s3,
    delete_file_from_s3,
    generate_presigned_url,
    upload_file_to_s3,
)


def get_document(db: Session, document_id: uuid.UUID) -> Optional[Document]:
    """Fetch single active document by ID"""
    return (
        db.query(Document)
        .filter(Document.id == document_id, Document.is_deleted == False)
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
    ADMIN → sees all documents
    EMPLOYEE → only sees documents of their assigned customers
    """
    query = db.query(Document).filter(Document.is_deleted == False)

    if requesting_user.role == UserRole.EMPLOYEE:
        query = query.join(Customer).filter(
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

    customer = (
        db.query(Customer)
        .filter(Customer.id == customer_id, Customer.is_deleted == False)
        .first()
    )

    if not customer:
        raise ValueError("Customer not found")

    # -----------------------------------
    # HASH FILE
    # -----------------------------------
    file_hash = hashlib.sha256(file_bytes).hexdigest()

    existing = (
        db.query(Document)
        .filter(
            Document.customer_id == customer_id,
            Document.file_hash == file_hash,
            Document.is_deleted == False,
        )
        .first()
    )

    if existing:
        raise ValueError("Duplicate file already uploaded")

    # Clean customer name for S3 path — remove spaces and special chars
    safe_name = customer.full_name.replace(" ", "_").lower()
    safe_name = "".join(c for c in safe_name if c.isalnum() or c == "_")

    save_file_name = os.path.basename(file_name)

    s3_key = f"customers/{safe_name}_{str(customer_id)[:8]}/{doc_type.value}/{uuid.uuid4()}/{save_file_name}"

    s3_uploaded = False

    try:
        upload_file_to_s3(
            file_bytes=file_bytes, s3_key=s3_key, content_type=content_type
        )

        s3_uploaded = True

        document = Document(
            customer_id=customer_id,
            doc_type=doc_type,
            s3_key=s3_key,
            file_name=save_file_name,
            content_type=content_type,
            file_size=len(file_bytes),
            file_hash=file_hash,
            created_by_id=created_by,
        )

        db.add(document)
        db.commit()
        db.refresh(document)

        return document

    except SQLAlchemyError as e:
        db.rollback()

        if s3_uploaded:
            delete_file_from_s3(s3_key)

        raise ValueError("Database save failed")


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
    new_s3_key = document.s3_key.replace("customers/", "archives/", 1)

    try:
        archive_file_in_s3(old_key=document.s3_key, new_key=new_s3_key)

        document.s3_key = new_s3_key
        document.is_deleted = True
        document.deleted_at = datetime.now(timezone.utc)
        document.deleted_by_id = deleted_by
        document.updated_by_id = deleted_by

        db.commit()
        db.refresh(document)

        return document

    except Exception:
        db.rollback()
        raise ValueError("Archive failed")


def restore_document(db: Session, document: Document, restored_by: uuid.UUID):

    # Guard — prevent silent key mismatch
    if "archives/" not in document.s3_key:
        raise ValueError(
            f"Document S3 key does not point to archives — cannot restore. Key: {document.s3_key}"
        )

    new_s3_key = document.s3_key.replace("archives/", "customers/", 1)

    try:
        archive_file_in_s3(old_key=document.s3_key, new_key=new_s3_key)

        document.s3_key = new_s3_key
        document.is_deleted = False
        document.deleted_at = None
        document.deleted_by_id = None
        document.updated_by_id = restored_by

        db.commit()
        db.refresh(document)

        return document

    except Exception:
        db.rollback()
        raise ValueError("Restore failed")
