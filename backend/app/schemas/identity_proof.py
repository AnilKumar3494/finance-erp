import uuid
from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.models.identity_proof import IdentityProofType


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class IdentityProofCreate(BaseModel):
    entity_type: Literal["customer", "personnel"]
    entity_id: uuid.UUID
    proof_type: IdentityProofType
    id_number: Optional[str] = Field(None, max_length=50)
    document_id: Optional[uuid.UUID] = None  # ID of already-uploaded document


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class IdentityProofResponse(BaseModel):
    id: uuid.UUID
    customer_id: Optional[uuid.UUID] = None
    personnel_id: Optional[uuid.UUID] = None
    proof_type: IdentityProofType
    id_number: Optional[str] = None
    document_id: Optional[uuid.UUID] = None
    is_deleted: bool
    created_at: datetime
    created_by_id: Optional[uuid.UUID] = None

    model_config = {"from_attributes": True}


# --------------------------------------------------
# LIST RESPONSE
# --------------------------------------------------
class IdentityProofListResponse(BaseModel):
    total: int
    results: list[IdentityProofResponse]
