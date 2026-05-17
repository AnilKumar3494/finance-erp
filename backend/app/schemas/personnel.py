import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator
import re

from app.models.personnel import PersonnelRole


# --------------------------------------------------
# PERSONNEL BASE
# --------------------------------------------------
class PersonnelBase(BaseModel):
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

    @field_validator("mobile_number")
    @classmethod
    def validate_mobile(cls, v: str) -> str:
        if not re.match(r"^[6-9]\d{9}$", v):
            raise ValueError("Invalid Indian mobile number")
        return v

    @field_validator("pincode")
    @classmethod
    def validate_pincode(cls, v: Optional[str]) -> Optional[str]:
        if v and not re.match(r"^[1-9]\d{5}$", v):
            raise ValueError("Invalid Indian PIN code (6 digits, no leading 0)")
        return v

    @field_validator("alt_mobile_number")
    @classmethod
    def validate_alt_mobile(cls, v: Optional[str]) -> Optional[str]:
        if v and not re.match(r"^[6-9]\d{9}$", v):
            raise ValueError("Invalid Indian mobile number")
        return v

    @field_validator("aadhaar_number")
    @classmethod
    def validate_aadhaar(cls, v: Optional[str]) -> Optional[str]:
        if v and not v.isdigit():
            raise ValueError("Aadhaar must be 12 digits")
        return v

    @field_validator("pan_number")
    @classmethod
    def validate_pan(cls, v: Optional[str]) -> Optional[str]:
        if v and not re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", v):
            raise ValueError("Invalid PAN format e.g. ABCDE1234F")
        return v.upper() if v else v


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class PersonnelCreate(PersonnelBase):
    pass


# --------------------------------------------------
# UPDATE (all optional)
# --------------------------------------------------
class PersonnelUpdate(BaseModel):
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

    @field_validator("mobile_number")
    @classmethod
    def validate_mobile(cls, v: Optional[str]) -> Optional[str]:
        if v and not re.match(r"^[6-9]\d{9}$", v):
            raise ValueError("Invalid Indian mobile number")
        return v

    @field_validator("pincode")
    @classmethod
    def validate_pincode(cls, v: Optional[str]) -> Optional[str]:
        if v and not re.match(r"^[1-9]\d{5}$", v):
            raise ValueError("Invalid Indian PIN code (6 digits, no leading 0)")
        return v

    @field_validator("alt_mobile_number")
    @classmethod
    def validate_alt_mobile(cls, v: Optional[str]) -> Optional[str]:
        if v and not re.match(r"^[6-9]\d{9}$", v):
            raise ValueError("Invalid Indian mobile number")
        return v

    @field_validator("aadhaar_number")
    @classmethod
    def validate_aadhaar(cls, v: Optional[str]) -> Optional[str]:
        if v and not v.isdigit():
            raise ValueError("Aadhaar must be 12 digits")
        return v

    @field_validator("pan_number")
    @classmethod
    def validate_pan(cls, v: Optional[str]) -> Optional[str]:
        if v and not re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", v):
            raise ValueError("Invalid PAN format e.g. ABCDE1234F")
        return v.upper() if v else v


# --------------------------------------------------
# RESPONSE (with masked Aadhaar/PAN)
# --------------------------------------------------
class PersonnelResponse(PersonnelBase):
    id: uuid.UUID
    is_deleted: bool
    created_at: datetime
    created_by_id: Optional[uuid.UUID] = None

    model_config = {"from_attributes": True}

    @field_validator("aadhaar_number", mode="after")
    @classmethod
    def mask_aadhaar(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) == 12:
            return f"********{v[-4:]}"
        return v

    @field_validator("pan_number", mode="after")
    @classmethod
    def mask_pan(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) == 10:
            return f"{v[:2]}******{v[-2:]}"
        return v


# --------------------------------------------------
# LOAN PERSONNEL — Add to loan
# --------------------------------------------------
class LoanPersonnelCreate(BaseModel):
    personnel_id: uuid.UUID
    role: PersonnelRole
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
    total: int
    results: list[LoanPersonnelResponse]


# --------------------------------------------------
# LOOKUP — used for "already exists" notification
# --------------------------------------------------
class LoanAssociationSummary(BaseModel):
    loan_personnel_id: uuid.UUID
    loan_id: uuid.UUID
    loan_number: str
    role: PersonnelRole
    relationship_to_hirer: Optional[str] = None
    customer_name: str


class PersonnelLookupResult(BaseModel):
    found: bool
    personnel: Optional[PersonnelResponse] = None
    existing_loan_associations: list[LoanAssociationSummary] = []
