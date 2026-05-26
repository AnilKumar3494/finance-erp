import logging
import tempfile
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
    Request,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.rate_limit import limiter
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
    issue_download,
    list_documents,
    restore_document,
    soft_delete_document,
    update_document_metadata,
    upload_document,
)

# Audit is written inside each service call inside the same transaction
# as the mutation. Routes no longer call write_audit directly.

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", tags=["Documents"])

# Spool to disk above this in-memory threshold to bound peak RSS under
# concurrent uploads. 2 MB covers most receipts/RC-copies inline; larger
# files (Aadhaar PDFs, signed loan agreements) spill to a temp file.
_UPLOAD_SPOOL_MAX_SIZE = 2 * 1024 * 1024  # 2 MB

# Magic-byte detection only needs the file head; reading more is wasted I/O.
_MAGIC_SNIFF_BYTES = 2048


def _read_upload_bounded(
    file: UploadFile, max_bytes: int
) -> bytes:
    """Stream the upload into a SpooledTemporaryFile, abort if it exceeds
    `max_bytes`. Returns the full byte buffer.

    Why spool: previously every upload accumulated chunks in a Python
    `list[bytes]`, pinning the entire file in heap for the duration of the
    request. With 10 MB cap × N concurrent uploads that's an easy OOM.
    """
    spool = tempfile.SpooledTemporaryFile(max_size=_UPLOAD_SPOOL_MAX_SIZE)
    total = 0
    try:
        while True:
            chunk = file.file.read(1024 * 1024)  # 1 MB blocks
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"File too large. Max "
                        f"{max_bytes // (1024 * 1024)} MB"
                    ),
                )
            spool.write(chunk)
        spool.seek(0)
        return spool.read()
    finally:
        spool.close()


# --------------------------------------------------
# UPLOAD
# --------------------------------------------------
@router.post(
    "/upload",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a document for a customer",
)
@limiter.limit(settings.RATE_LIMIT_UPLOAD)
def upload(
    request: Request,
    customer_id: uuid.UUID = Form(...),
    doc_type: DocCategory = Form(...),
    loan_id: Optional[uuid.UUID] = Form(None),
    transaction_id: Optional[uuid.UUID] = Form(None),
    vehicle_id: Optional[uuid.UUID] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # NOTE: route is sync (not async). The service does blocking SQLAlchemy
    # + boto3 PutObject; running those inside the event loop blocks every
    # other request. FastAPI threadpools sync routes for us.
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Missing filename"
        )

    # Cheap extension check first (rejects obvious junk before reading).
    ext = Path(file.filename).suffix.lower()
    if ext not in settings.ALLOWED_DOCUMENT_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid file type. Allowed: "
                f"{', '.join(sorted(settings.ALLOWED_DOCUMENT_EXTENSIONS))}"
            ),
        )

    # Stream + size-cap into a spooled temp file.
    file_bytes = _read_upload_bounded(file, settings.MAX_DOCUMENT_UPLOAD_BYTES)

    # Trust magic-byte detection over the client-supplied content_type.
    detected_mime = magic.from_buffer(file_bytes[:_MAGIC_SNIFF_BYTES], mime=True)
    if detected_mime not in settings.ALLOWED_DOCUMENT_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file content (detected: {detected_mime})",
        )

    # AKTODO: hand file_bytes to AV scanner (e.g. ClamAV) before persisting.

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
            request=request,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return DocumentResponse.model_validate(document)


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
    loan_id: Optional[uuid.UUID] = Query(None),
    vehicle_id: Optional[uuid.UUID] = Query(None),
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
        loan_id=loan_id,
        vehicle_id=vehicle_id,
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
    request: Request,
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

    # issue_download generates the presigned URL AND writes the audit row
    # in one commit — the URL is never returned to the client without an
    # audit trail.
    try:
        url = issue_download(
            db,
            document,
            requested_by=current_user.id,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )

    return DocumentDownloadResponse(
        document_id=document.id,
        file_name=document.file_name,
        download_url=url,
        expires_in_seconds=settings.PRESIGNED_URL_TTL_SECONDS,
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
    request: Request,
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

    try:
        updated = update_document_metadata(
            db,
            document,
            doc_type=payload.doc_type,
            file_name=payload.file_name,
            updated_by=current_user.id,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return DocumentResponse.model_validate(updated)


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Archive (soft delete) a document",
)
def delete(
    request: Request,
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
        soft_delete_document(
            db=db,
            document=document,
            deleted_by=current_user.id,
            request=request,
        )
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
    request: Request,
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
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document is already active",
        )
    try:
        restored = restore_document(
            db=db,
            document=document,
            restored_by=current_user.id,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return DocumentResponse.model_validate(restored)
