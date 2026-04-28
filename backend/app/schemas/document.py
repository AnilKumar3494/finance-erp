import uuid
from typing import Optional

from pydantic import BaseModel, computed_field

from app.models.document import DocCategory


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class DocumentResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    doc_type: DocCategory
    s3_key: str
    file_name: Optional[str]
    content_type: Optional[str]
    is_deleted: bool
    created_by_id: Optional[uuid.UUID]
    uploaded_by_name: Optional[str] = None

    @computed_field
    @property
    def file_size_display(self) -> Optional[str]:
        """Human readable file size e.g. 2.3 MB"""
        if not self.file_size:
            return None
        if self.file_size < 1024:
            return f"{self.file_size} B"
        elif self.file_size < 1024 * 1024:
            return f"{self.file_size / 1024:.1f} KB"
        else:
            return f"{self.file_size / (1024 * 1024):.1f} MB"

    model_config = {"from_attributes": True}


# --------------------------------------------------
# DOWNLOAD URL RESPONSE
# --------------------------------------------------
class DocumentDownloadResponse(BaseModel):
    document_id: uuid.UUID
    file_name: Optional[str]
    download_url: str
    expires_in_seconds: int = 3600


# --------------------------------------------------
# LIST RESPONSE
# --------------------------------------------------
class DocumentListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[DocumentResponse]
