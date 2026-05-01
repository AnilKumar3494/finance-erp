import uuid
from typing import Optional

from pydantic import BaseModel, Field, field_validator
import re


# --------------------------------------------------
# BASE
# --------------------------------------------------
class CustomerBase(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=255)
    mobile_number: str = Field(..., min_length=10, max_length=15)
    aadhaar_number: Optional[str] = Field(None, min_length=12, max_length=12)
    pan_number: Optional[str] = Field(None, min_length=10, max_length=10)
    assigned_employee_id: Optional[uuid.UUID] = None

    @field_validator("mobile_number")
    @classmethod
    def validate_mobile(cls, v: str) -> str:
        if not re.match(r"^[6-9]\d{9}$", v):
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
class CustomerCreate(CustomerBase):
    pass


# --------------------------------------------------
# UPDATE (All fields optional)
# --------------------------------------------------
class CustomerUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=2, max_length=255)
    mobile_number: Optional[str] = Field(None, min_length=10, max_length=15)
    aadhaar_number: Optional[str] = Field(None, min_length=12, max_length=12)
    pan_number: Optional[str] = Field(None, min_length=10, max_length=10)
    assigned_employee_id: Optional[uuid.UUID] = None


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class CustomerResponse(CustomerBase):
    id: uuid.UUID
    is_deleted: bool
    created_by_id: Optional[uuid.UUID]
    assigned_employee_id: Optional[uuid.UUID]
    assigned_employee_name: Optional[str] = None

    model_config = {"from_attributes": True}


# --------------------------------------------------
# LIST RESPONSE (Paginated)
# --------------------------------------------------
class CustomerListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[CustomerResponse]
