"""
Identity Proof schemas.

Validation rules mirror the customer schema's Indian-format validators so a
PAN/AADHAAR/Pincode written to identity_proofs follows the same shape as one
written to customers. Without this the frontend would happily accept
"abc123" as an Aadhaar and we'd store garbage forever.

The response masks `id_number` for non-admin callers via a constructor
helper (`from_orm_for_user`). This blunts the personnel-branch
PII-enumeration vector: any authenticated user can list proofs by
personnel_id, but only admins see the unmasked value.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.models.identity_proof import IdentityProof, IdentityProofType
from app.models.user import User, UserRole
from app.utils.pii import mask_aadhaar, mask_pan

# --------------------------------------------------
# Format regexes — local; same patterns used in schemas/customer.py.
# --------------------------------------------------
_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
_DL_RE = re.compile(r"^[A-Z]{2}\d{2}\d{11}$")  # after stripping spaces/dashes
_VOTER_RE = re.compile(r"^[A-Z]{3}[0-9]{7}$")  # standard EPIC format


def _normalize_and_validate_id_number(
    proof_type: "IdentityProofType", v: Optional[str]
) -> Optional[str]:
    """Return the canonical, validated form of `id_number` for the given
    proof_type, or raise ValueError. `None` is allowed — a proof can be
    filed with just a scanned document and no transcribed number."""
    if v is None:
        return v
    v = v.strip()
    if not v:
        return None

    if proof_type == IdentityProofType.AADHAAR:
        if not (v.isdigit() and len(v) == 12):
            raise ValueError("Aadhaar must be exactly 12 digits")
        return v

    if proof_type == IdentityProofType.PAN:
        v = v.upper()
        if not _PAN_RE.match(v):
            raise ValueError("Invalid PAN format e.g. ABCDE1234F")
        return v

    if proof_type == IdentityProofType.DRIVING_LICENSE:
        v = v.upper().replace(" ", "").replace("-", "")
        if not _DL_RE.match(v):
            raise ValueError("Invalid Driving License number")
        return v

    if proof_type == IdentityProofType.VOTER_ID:
        v = v.upper()
        if not _VOTER_RE.match(v):
            raise ValueError("Invalid Voter ID (EPIC) format")
        return v

    # RATION_CARD / MGNREGA_CARD / OTHER: no canonical national format,
    # so just bound the length (already enforced by Field max_length=50).
    return v


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class IdentityProofCreate(BaseModel):
    entity_type: Literal["customer", "personnel"]
    entity_id: uuid.UUID
    proof_type: IdentityProofType
    id_number: Optional[str] = Field(None, max_length=50)
    document_id: Optional[uuid.UUID] = None  # ID of already-uploaded document

    @model_validator(mode="after")
    def _validate_id_number(self):
        self.id_number = _normalize_and_validate_id_number(
            self.proof_type, self.id_number
        )
        return self


# --------------------------------------------------
# UPDATE
# --------------------------------------------------
# Only `id_number` is mutable. Changing proof_type or owning entity would
# break the audit chain and re-trip the partial uniqueness constraints,
# so those are immutable. The service injects the persisted proof_type
# into the validator so the format check matches the row on disk.
# --------------------------------------------------
class IdentityProofUpdate(BaseModel):
    id_number: Optional[str] = Field(None, max_length=50)


# --------------------------------------------------
# RESPONSE — nested document mini for the frontend
# --------------------------------------------------
class _DocumentMini(BaseModel):
    id: uuid.UUID
    file_name: Optional[str] = None
    content_type: Optional[str] = None
    doc_type: Optional[str] = None

    model_config = {"from_attributes": True}


class IdentityProofResponse(BaseModel):
    id: uuid.UUID
    customer_id: Optional[uuid.UUID] = None
    personnel_id: Optional[uuid.UUID] = None
    proof_type: IdentityProofType
    id_number: Optional[str] = None
    document_id: Optional[uuid.UUID] = None
    document: Optional[_DocumentMini] = None
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    created_by_id: Optional[uuid.UUID] = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_for_user(
        cls, proof: "IdentityProof", *, user: "User"
    ) -> "IdentityProofResponse":
        """Build a response, masking `id_number` for non-admin callers.

        Aadhaar/PAN reuse the customer-module mask shape
        (`********9012` / `AB******4F`). Other proof types fall back to a
        last-4 reveal so the frontend can still show a "...3456" hint
        without leaking the full number.
        """
        obj = cls.model_validate(proof)
        if user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
            return obj
        obj.id_number = _mask_for_type(proof.proof_type, obj.id_number)
        return obj


def _mask_for_type(
    proof_type: "IdentityProofType", v: Optional[str]
) -> Optional[str]:
    if not v:
        return v
    if proof_type == IdentityProofType.AADHAAR:
        return mask_aadhaar(v)
    if proof_type == IdentityProofType.PAN:
        return mask_pan(v)
    if len(v) <= 4:
        return "*" * len(v)
    return ("*" * (len(v) - 4)) + v[-4:]


# --------------------------------------------------
# LIST RESPONSE — same shape as every other paginated endpoint in the
# API, so the frontend has one table-rendering contract. Unpaginated
# endpoints set page=1, page_size=total at the route layer.
# --------------------------------------------------
class IdentityProofListResponse(BaseModel):
    total: int
    page: int = 1
    page_size: int
    results: list[IdentityProofResponse]
