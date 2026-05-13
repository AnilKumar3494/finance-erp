import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from app.models.stability_document import StabilityDocType


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class StabilityDocumentCreate(BaseModel):
    doc_subtype: StabilityDocType
    description: Optional[str] = Field(None, max_length=500)
    cheque_count: Optional[int] = Field(None, ge=1)
    document_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def validate_subtype_fields(self):
        if self.doc_subtype == StabilityDocType.OTHER and not self.description:
            raise ValueError("description is required when doc_subtype is OTHER")
        if self.doc_subtype == StabilityDocType.CHEQUE_PDC and self.cheque_count is None:
            raise ValueError("cheque_count is required when doc_subtype is CHEQUE_PDC")
        return self


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class StabilityDocumentResponse(BaseModel):
    id: uuid.UUID
    loan_id: uuid.UUID
    doc_subtype: StabilityDocType
    description: Optional[str] = None
    cheque_count: Optional[int] = None
    document_id: Optional[uuid.UUID] = None
    is_deleted: bool
    created_at: datetime
    created_by_id: Optional[uuid.UUID] = None

    model_config = {"from_attributes": True}


# --------------------------------------------------
# LIST RESPONSE
# --------------------------------------------------
class StabilityDocumentListResponse(BaseModel):
    total: int
    results: list[StabilityDocumentResponse]
