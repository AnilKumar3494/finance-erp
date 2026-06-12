import re
import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models.personnel import PersonnelRole
from app.utils.pii import mask_aadhaar, mask_pan

# Indian formats
_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")
_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
_PINCODE_RE = re.compile(r"^[1-9]\d{5}$")


# --------------------------------------------------
# SHARED VALIDATORS
# --------------------------------------------------
class _PersonnelValidatorsMixin(BaseModel):
    @field_validator("mobile_number", check_fields=False)
    @classmethod
    def _v_mobile(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _MOBILE_RE.match(v):
            raise ValueError("Invalid Indian mobile number")
        return v

    @field_validator("alt_mobile_number", check_fields=False)
    @classmethod
    def _v_alt_mobile(cls, v: Optional[str]) -> Optional[str]:
        if v and not _MOBILE_RE.match(v):
            raise ValueError("Invalid Indian mobile number")
        return v

    @field_validator("aadhaar_number", check_fields=False)
    @classmethod
    def _v_aadhaar(cls, v: Optional[str]) -> Optional[str]:
        if v and (not v.isdigit() or len(v) != 12):
            raise ValueError("Aadhaar must be exactly 12 digits")
        return v

    @field_validator("pan_number", check_fields=False)
    @classmethod
    def _v_pan(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.upper()
        if not _PAN_RE.match(v):
            raise ValueError("Invalid PAN format e.g. ABCDE1234F")
        return v

    @field_validator("pincode", check_fields=False)
    @classmethod
    def _v_pincode(cls, v: Optional[str]) -> Optional[str]:
        if v and not _PINCODE_RE.match(v):
            raise ValueError("Invalid Indian PIN code (6 digits, no leading 0)")
        return v


# --------------------------------------------------
# BASE
# --------------------------------------------------
class PersonnelBase(_PersonnelValidatorsMixin):
    full_name: str = Field(..., min_length=2, max_length=255)
    mobile_number: str = Field(..., min_length=10, max_length=15)
    date_of_birth: Optional[date] = None
    alt_mobile_number: Optional[str] = Field(None, min_length=10, max_length=15)
    aadhaar_number: Optional[str] = Field(None, min_length=12, max_length=12)
    pan_number: Optional[str] = Field(None, min_length=10, max_length=10)
    address_line_1: Optional[str] = Field(None, max_length=500)
    address_line_2: Optional[str] = Field(None, max_length=500)
    mandal_village: Optional[str] = Field(None, max_length=100)
    pincode: Optional[str] = Field(None, min_length=6, max_length=6)
    remarks: Optional[str] = None


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class PersonnelCreate(PersonnelBase):
    pass


# --------------------------------------------------
# UPDATE (all fields optional; SAME validators as create via the mixin)
# --------------------------------------------------
class PersonnelUpdate(_PersonnelValidatorsMixin):
    full_name: Optional[str] = Field(None, min_length=2, max_length=255)
    mobile_number: Optional[str] = Field(None, min_length=10, max_length=15)
    date_of_birth: Optional[date] = None
    alt_mobile_number: Optional[str] = Field(None, min_length=10, max_length=15)
    aadhaar_number: Optional[str] = Field(None, min_length=12, max_length=12)
    pan_number: Optional[str] = Field(None, min_length=10, max_length=10)
    address_line_1: Optional[str] = Field(None, max_length=500)
    address_line_2: Optional[str] = Field(None, max_length=500)
    mandal_village: Optional[str] = Field(None, max_length=100)
    pincode: Optional[str] = Field(None, min_length=6, max_length=6)
    remarks: Optional[str] = None


# --------------------------------------------------
# RESPONSE (Aadhaar/PAN masked on the wire)
# --------------------------------------------------
class PersonnelResponse(PersonnelBase):
    id: uuid.UUID
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    created_by_id: Optional[uuid.UUID] = None

    model_config = {"from_attributes": True}

    @field_validator("aadhaar_number", mode="after")
    @classmethod
    def _mask_aadhaar(cls, v: Optional[str]) -> Optional[str]:
        return mask_aadhaar(v)

    @field_validator("pan_number", mode="after")
    @classmethod
    def _mask_pan(cls, v: Optional[str]) -> Optional[str]:
        return mask_pan(v)


# --------------------------------------------------
# UNMASKED RESPONSE (Admin view only — audited at the route)
# --------------------------------------------------
class PersonnelUnmaskedPII(BaseModel):
    aadhaar_number: Optional[str] = None
    pan_number: Optional[str] = None

    model_config = {"from_attributes": True}


# --------------------------------------------------
# LOAN PERSONNEL — Add to loan
# --------------------------------------------------
class LoanPersonnelCreate(BaseModel):
    personnel_id: uuid.UUID
    role: PersonnelRole
    relationship_to_hirer: Optional[str] = Field(None, max_length=100)


# --------------------------------------------------
# LOAN PERSONNEL — Update (the link's relationship to the hirer)
# --------------------------------------------------
class LoanPersonnelUpdate(BaseModel):
    relationship_to_hirer: Optional[str] = Field(None, max_length=100)


# --------------------------------------------------
# LOAN PERSONNEL — Response (embeds PersonnelResponse)
# --------------------------------------------------
class LoanPersonnelResponse(BaseModel):
    id: uuid.UUID
    loan_id: uuid.UUID
    personnel_id: uuid.UUID
    role: PersonnelRole
    relationship_to_hirer: Optional[str] = None
    created_at: datetime
    personnel: PersonnelResponse

    model_config = {"from_attributes": True}


class LoanPersonnelListResponse(BaseModel):
    """Uniform paginated shape (G3) — `page` / `page_size` are dummy when
    this endpoint isn't paginated, but their presence keeps the frontend
    table component on a single render path."""

    total: int
    page: int = 1
    page_size: int
    results: list[LoanPersonnelResponse]


# --------------------------------------------------
# LOOKUP — used for "already exists" notification
# --------------------------------------------------
class LoanAssociationSummary(BaseModel):
    loan_personnel_id: uuid.UUID
    loan_id: uuid.UUID
    loan_number: str
    hp_number: Optional[str] = None
    role: PersonnelRole
    relationship_to_hirer: Optional[str] = None
    customer_name: str


class PersonnelLookupResult(BaseModel):
    found: bool
    personnel: Optional[PersonnelResponse] = None
    existing_loan_associations: list[LoanAssociationSummary] = []
