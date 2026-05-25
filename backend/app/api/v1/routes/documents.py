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
    get_download_url,
    list_documents,
    restore_document,
    soft_delete_document,
    update_document_metadata,
    upload_document,
)
from app.utils.audit import write_audit

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
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Audit AFTER the service commit; if the audit write itself fails it
    # uses a SAVEPOINT internally so the upload is not rolled back.
    write_audit(
        db,
        action_type="DOCUMENT_UPLOAD",
        target_table="documents",
        record_id=document.id,
        user_id=current_user.id,
        new_data={
            "customer_id": str(document.customer_id),
            "doc_type": document.doc_type.value,
            "loan_id": str(document.loan_id) if document.loan_id else None,
            "transaction_id": (
                str(document.transaction_id) if document.transaction_id else None
            ),
            "vehicle_id": str(document.vehicle_id) if document.vehicle_id else None,
            "file_size": document.file_size,
            "content_type": document.content_type,
        },
        request=request,
    )
    db.commit()
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

    try:
        url = get_download_url(document)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )

    # Every presigned-URL issuance is a sensitive event — NBFC audit
    # mandate. Record who, when, and what was unlocked. Never log the URL
    # itself (it's a bearer credential).
    write_audit(
        db,
        action_type="DOCUMENT_DOWNLOAD",
        target_table="documents",
        record_id=document.id,
        user_id=current_user.id,
        new_data={
            "doc_type": document.doc_type.value,
            "customer_id": str(document.customer_id),
            "file_name": document.file_name,
        },
        request=request,
    )
    db.commit()

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

    before = {
        "doc_type": document.doc_type.value,
        "file_name": document.file_name,
    }
    try:
        updated = update_document_metadata(
            db,
            document,
            doc_type=payload.doc_type,
            file_name=payload.file_name,
            updated_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    write_audit(
        db,
        action_type="DOCUMENT_UPDATE",
        target_table="documents",
        record_id=updated.id,
        user_id=current_user.id,
        old_data=before,
        new_data={
            "doc_type": updated.doc_type.value,
            "file_name": updated.file_name,
        },
        request=request,
    )
    db.commit()
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
        soft_delete_document(db=db, document=document, deleted_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    write_audit(
        db,
        action_type="DOCUMENT_DELETE",
        target_table="documents",
        record_id=document.id,
        user_id=current_user.id,
        old_data={
            "doc_type": document.doc_type.value,
            "customer_id": str(document.customer_id),
            "file_name": document.file_name,
        },
        request=request,
    )
    db.commit()


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
            db=db, document=document, restored_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    write_audit(
        db,
        action_type="DOCUMENT_RESTORE",
        target_table="documents",
        record_id=restored.id,
        user_id=current_user.id,
        new_data={
            "doc_type": restored.doc_type.value,
            "file_name": restored.file_name,
        },
        request=request,
    )
    db.commit()
    return DocumentResponse.model_validate(restored)
