import uuid
from typing import Optional

from pydantic import BaseModel

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
    results: list[DocumentResponse]
