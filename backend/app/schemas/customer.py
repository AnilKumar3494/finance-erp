import re
import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.utils.pii import mask_aadhaar, mask_pan

# Indian formats
_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")
_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
_PINCODE_RE = re.compile(r"^[1-9]\d{5}$")


# --------------------------------------------------
# SHARED VALIDATORS
# --------------------------------------------------
class _CustomerValidatorsMixin(BaseModel):
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
class CustomerBase(_CustomerValidatorsMixin):
    full_name: str = Field(..., min_length=2, max_length=255)
    mobile_number: str = Field(..., min_length=10, max_length=15)
    aadhaar_number: Optional[str] = Field(None, min_length=12, max_length=12)
    pan_number: Optional[str] = Field(None, min_length=10, max_length=10)
    assigned_employee_id: Optional[uuid.UUID] = None
    date_of_birth: Optional[date] = None
    alt_mobile_number: Optional[str] = Field(None, min_length=10, max_length=15)
    address_line_1: Optional[str] = Field(None, max_length=500)
    address_line_2: Optional[str] = Field(None, max_length=500)
    mandal_village: Optional[str] = Field(None, max_length=100)
    pincode: Optional[str] = Field(None, min_length=6, max_length=6)
    remarks: Optional[str] = None


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class CustomerCreate(CustomerBase):
    pass


# --------------------------------------------------
# UPDATE (all fields optional; SAME validators as create via the mixin)
# --------------------------------------------------
class CustomerUpdate(_CustomerValidatorsMixin):
    full_name: Optional[str] = Field(None, min_length=2, max_length=255)
    mobile_number: Optional[str] = Field(None, min_length=10, max_length=15)
    aadhaar_number: Optional[str] = Field(None, min_length=12, max_length=12)
    pan_number: Optional[str] = Field(None, min_length=10, max_length=10)
    assigned_employee_id: Optional[uuid.UUID] = None
    date_of_birth: Optional[date] = None
    alt_mobile_number: Optional[str] = Field(None, min_length=10, max_length=15)
    address_line_1: Optional[str] = Field(None, max_length=500)
    address_line_2: Optional[str] = Field(None, max_length=500)
    mandal_village: Optional[str] = Field(None, max_length=100)
    pincode: Optional[str] = Field(None, min_length=6, max_length=6)
    remarks: Optional[str] = None


# --------------------------------------------------
# RESPONSE (Aadhaar/PAN masked on the wire)
# --------------------------------------------------
class CustomerResponse(CustomerBase):
    id: uuid.UUID
    is_deleted: bool
    created_by_id: Optional[uuid.UUID]
    assigned_employee_id: Optional[uuid.UUID]
    assigned_employee_name: Optional[str] = None
    primary_loan_number: Optional[str] = None
    primary_vehicle_number: Optional[str] = None
    # WhatsApp reminder opt-out state (toggled via /reminders/customers/{id}).
    whatsapp_reminders_enabled: bool = True
    created_at: datetime
    updated_at: datetime

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
# LIST RESPONSE (Paginated)
# --------------------------------------------------
class CustomerListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[CustomerResponse]


# --------------------------------------------------
# UNMASKED RESPONSE (Admin view only — audited at the route)
# --------------------------------------------------
class CustomerUnmaskedPII(BaseModel):
    aadhaar_number: Optional[str] = None
    pan_number: Optional[str] = None

    model_config = {"from_attributes": True}
