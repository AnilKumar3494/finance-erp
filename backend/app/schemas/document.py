import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, computed_field

from app.models.document import DocCategory


# --------------------------------------------------
# Mini uploader (used inside DocumentResponse via relationship)
# --------------------------------------------------
class _UploaderMini(BaseModel):
    id: uuid.UUID
    full_name: Optional[str] = None
    model_config = {"from_attributes": True}


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class DocumentResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    loan_id: Optional[uuid.UUID] = None
    transaction_id: Optional[uuid.UUID] = None
    vehicle_id: Optional[uuid.UUID] = None
    doc_type: DocCategory
    s3_key: str
    file_name: Optional[str]
    content_type: Optional[str]
    file_size: Optional[int] = None
    file_hash: Optional[str] = None
    created_by_id: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime
    is_deleted: bool
    deleted_at: Optional[datetime] = None
    deleted_by_id: Optional[uuid.UUID] = None
    # Eager-loaded relationship (joinedload in service)
    uploaded_by: Optional[_UploaderMini] = None

    @computed_field
    @property
    def uploaded_by_name(self) -> Optional[str]:
        return self.uploaded_by.full_name if self.uploaded_by else None

    @computed_field
    @property
    def file_size_display(self) -> Optional[str]:
        if not self.file_size:
            return None
        if self.file_size < 1024:
            return f"{self.file_size} B"
        if self.file_size < 1024 * 1024:
            return f"{self.file_size / 1024:.1f} KB"
        return f"{self.file_size / (1024 * 1024):.1f} MB"

    model_config = {"from_attributes": True}


# --------------------------------------------------
# DOWNLOAD URL RESPONSE
# --------------------------------------------------
class DocumentDownloadResponse(BaseModel):
    document_id: uuid.UUID
    file_name: Optional[str]
    download_url: str
    expires_in_seconds: int = 480


# --------------------------------------------------
# LIST RESPONSE
# --------------------------------------------------
class DocumentListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[DocumentResponse]


# --------------------------------------------------
# UPDATE
# --------------------------------------------------
class DocumentUpdate(BaseModel):
    doc_type: Optional[DocCategory] = None
    file_name: Optional[str] = Field(None, max_length=255)
