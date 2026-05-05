import logging
import uuid
from pathlib import Path
from typing import Optional

import magic
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

from app.core.config import settings
from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin
from app.models.document import DocCategory
from app.models.user import User
from app.schemas.document import (
    DocumentDownloadResponse,
    DocumentListResponse,
    DocumentResponse,
    DocumentUpdate,
)
from app.services.document import (
    check_document_access,
    get_document,
    get_document_including_deleted,
    get_download_url,
    list_documents,
    restore_document,
    soft_delete_document,
    upload_document,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", tags=["Documents"])


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
    loan_id: Optional[uuid.UUID] = Form(None),
    transaction_id: Optional[uuid.UUID] = Form(None),
    vehicle_id: Optional[uuid.UUID] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Missing filename"
        )

    # Cheap extension check first (rejects obvious junk before reading)
    ext = Path(file.filename).suffix.lower()
    if ext not in settings.ALLOWED_DOCUMENT_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid file type. Allowed: "
                f"{', '.join(sorted(settings.ALLOWED_DOCUMENT_EXTENSIONS))}"
            ),
        )

    # Stream and abort on size limit (don't load full file blindly)
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(1024 * 1024):  # 1MB blocks
        total += len(chunk)
        if total > settings.MAX_DOCUMENT_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"File too large. Max "
                    f"{settings.MAX_DOCUMENT_UPLOAD_BYTES // (1024*1024)} MB"
                ),
            )
        chunks.append(chunk)
    file_bytes = b"".join(chunks)

    # trust magic-byte detection over client-supplied content_type
    detected_mime = magic.from_buffer(file_bytes[:2048], mime=True)
    if detected_mime not in settings.ALLOWED_DOCUMENT_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file content (detected: {detected_mime})",
        )

    # AKTODO: hand file_bytes to AV scanner (e.g. ClamAV) before persisting.
    #         Reject if infected, mark scan_status=PENDING and scan async otherwise.

    try:
        document = upload_document(
            db=db,
            requesting_user=current_user,
            customer_id=customer_id,
            doc_type=doc_type,
            loan_id=loan_id,
            transaction_id=transaction_id,
            vehicle_id=vehicle_id,
            file_bytes=file_bytes,
            file_name=file.filename,
            content_type=detected_mime,
            created_by=current_user.id,
        )
        return DocumentResponse.model_validate(document)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


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
    return DocumentListResponse(
        total=total,
        page=page,
        page_size=page_size,
        results=[DocumentResponse.model_validate(d) for d in results],
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
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )
    if not check_document_access(document, current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )
    return DocumentResponse.model_validate(document)


# --------------------------------------------------
# DOWNLOAD
# --------------------------------------------------
@router.get(
    "/{document_id}/download",
    response_model=DocumentDownloadResponse,
    summary="Get a pre-signed download URL (8-min TTL)",
)
def download(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    document = get_document(db, document_id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )
    if not check_document_access(document, current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )

    # AKTODO: log download event to a dedicated audit table

    try:
        return DocumentDownloadResponse(
            document_id=document.id,
            file_name=document.file_name,
            download_url=get_download_url(document),
            expires_in_seconds=settings.PRESIGNED_URL_TTL_SECONDS,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


# --------------------------------------------------
# UPDATE METADATA
# --------------------------------------------------
@router.patch(
    "/{document_id}",
    response_model=DocumentResponse,
    summary="Update document metadata (e.g. fix wrong doc_type)",
)
def update_metadata(
    document_id: uuid.UUID,
    payload: DocumentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    document = get_document(db, document_id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(document, field, value)
    document.updated_by_id = current_user.id

    db.commit()
    db.refresh(document)
    return DocumentResponse.model_validate(document)


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
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )
    try:
        soft_delete_document(db=db, document=document, deleted_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


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
    document = get_document_including_deleted(db, document_id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )
    if not document.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Document is already active"
        )
    try:
        restored = restore_document(
            db=db, document=document, restored_by=current_user.id
        )
        return DocumentResponse.model_validate(restored)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
