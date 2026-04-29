import uuid
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin
from app.models.document import DocCategory, Document
from app.models.user import User
from app.schemas.document import (
    DocumentDownloadResponse,
    DocumentListResponse,
    DocumentResponse,
)
from app.services.document import (
    check_document_access,
    enrich_document,
    get_document,
    get_download_url,
    list_documents,
    restore_document,
    soft_delete_document,
    upload_document,
)

router = APIRouter(prefix="/documents", tags=["Documents"])

ALLOWED_EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".doc",
    ".docx",
    ".txt",
}

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


# --------------------------------------------------
# UPLOAD
# --------------------------------------------------
@router.post(
    "/upload",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a document for a customer",
)
async def upload(
    customer_id: uuid.UUID = Form(...),
    doc_type: DocCategory = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ext = Path(file.filename).suffix.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    file_bytes = await file.read()

    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large. Maximum size is 10MB",
        )

    try:
        document = upload_document(
            db=db,
            customer_id=customer_id,
            doc_type=doc_type,
            file_bytes=file_bytes,
            file_name=file.filename,
            content_type=file.content_type,
            created_by=current_user.id,
        )

        return DocumentResponse(**enrich_document(document, db))

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


# --------------------------------------------------
# LIST
# --------------------------------------------------
@router.get(
    "/",
    response_model=DocumentListResponse,
    summary="List documents — Admin sees all, Employee sees assigned only",
)
def list_all(
    customer_id: Optional[uuid.UUID] = Query(None),
    doc_type: Optional[DocCategory] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    results, total = list_documents(
        db=db,
        requesting_user=current_user,
        customer_id=customer_id,
        doc_type=doc_type,
        page=page,
        page_size=page_size,
    )

    enriched = [DocumentResponse(**enrich_document(doc, db)) for doc in results]

    return DocumentListResponse(
        total=total,
        page=page,
        page_size=page_size,
        results=enriched,
    )


# --------------------------------------------------
# GET BY ID
# --------------------------------------------------
@router.get(
    "/{document_id}",
    response_model=DocumentResponse,
    summary="Get document metadata",
)
def get_one(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    document = get_document(db, document_id)

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    if not check_document_access(document, current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    return DocumentResponse(**enrich_document(document, db))


# --------------------------------------------------
# DOWNLOAD
# --------------------------------------------------
@router.get(
    "/{document_id}/download",
    response_model=DocumentDownloadResponse,
    summary="Get a pre-signed download URL",
)
def download(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    document = get_document(db, document_id)

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    if not check_document_access(document, current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    try:
        return DocumentDownloadResponse(
            document_id=document.id,
            file_name=document.file_name,
            download_url=get_download_url(document),
            expires_in_seconds=3600,
        )

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Archive (soft delete) a document",
)
def delete(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    document = get_document(db, document_id)

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    try:
        soft_delete_document(
            db=db,
            document=document,
            deleted_by=current_user.id,
        )

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


# --------------------------------------------------
# RESTORE
# --------------------------------------------------
@router.post(
    "/{document_id}/restore",
    response_model=DocumentResponse,
    summary="Restore an archived document",
)
def restore(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    # Must fetch INCLUDING deleted docs
    document = db.query(Document).filter(Document.id == document_id).first()

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    if not document.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document is already active",
        )

    try:
        restored = restore_document(
            db=db,
            document=document,
            restored_by=current_user.id,
        )

        return DocumentResponse(**enrich_document(restored, db))

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
