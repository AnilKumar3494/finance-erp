"""
Stability Document schemas.

Mirrors the loan-side stability verification artifacts (property tax,
bank statement, cheque PDC, etc.). The DB now enforces both the
`cheque_count` invariant and the description-length cap (migration 009);
the Pydantic schema does the same up-front so the user sees a clean 422
instead of a constraint violation.
"""
from __future__ import annotations

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
        if (
            self.doc_subtype == StabilityDocType.CHEQUE_PDC
            and self.cheque_count is None
        ):
            raise ValueError(
                "cheque_count is required when doc_subtype is CHEQUE_PDC"
            )
        if (
            self.doc_subtype != StabilityDocType.CHEQUE_PDC
            and self.cheque_count is not None
        ):
            # The DB CHECK ck_stability_cheque_count rejects this; we
            # surface it early as a clean 422 instead of a 500.
            raise ValueError(
                "cheque_count is only valid when doc_subtype is CHEQUE_PDC"
            )
        return self


# --------------------------------------------------
# UPDATE — description + cheque_count only. doc_subtype is immutable so
# the (loan, subtype) audit narrative stays coherent and we don't have to
# re-run the CHECK invariant against a moving target.
# --------------------------------------------------
class StabilityDocumentUpdate(BaseModel):
    description: Optional[str] = Field(None, max_length=500)
    cheque_count: Optional[int] = Field(None, ge=1)


# --------------------------------------------------
# RESPONSE — nested document mini for frontend rendering
# --------------------------------------------------
class _DocumentMini(BaseModel):
    id: uuid.UUID
    file_name: Optional[str] = None
    content_type: Optional[str] = None
    doc_type: Optional[str] = None

    model_config = {"from_attributes": True}


class StabilityDocumentResponse(BaseModel):
    id: uuid.UUID
    loan_id: uuid.UUID
    doc_subtype: StabilityDocType
    description: Optional[str] = None
    cheque_count: Optional[int] = None
    document_id: Optional[uuid.UUID] = None
    document: Optional[_DocumentMini] = None
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    created_by_id: Optional[uuid.UUID] = None

    model_config = {"from_attributes": True}


# --------------------------------------------------
# LIST RESPONSE — uniform paginated shape (G3).
# --------------------------------------------------
class StabilityDocumentListResponse(BaseModel):
    total: int
    page: int = 1
    page_size: int
    results: list[StabilityDocumentResponse]
