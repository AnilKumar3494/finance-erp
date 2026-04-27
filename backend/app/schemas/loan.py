import uuid
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models.loan import LoanStatus


# --------------------------------------------------
# BASE
# --------------------------------------------------
class LoanBase(BaseModel):
    customer_id: uuid.UUID
    vehicle_id: Optional[uuid.UUID] = None
    principal: Decimal = Field(..., gt=0, description="Loan amount must be positive")
    interest_rate: Decimal = Field(
        ..., gt=0, le=100, description="Annual interest rate"
    )
    tenure: int = Field(..., gt=0, le=360, description="Tenure in months")

    @field_validator("principal")
    @classmethod
    def validate_principal(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Principal must be greater than 0")
        return v.quantize((Decimal("0.01")))

    @field_validator("interest_rate")
    @classmethod
    def validate_interest_rate(cls, v: Decimal) -> Decimal:
        if v <= 0 or v > 100:
            raise ValueError("Interest rate must be between 0 and 100")
        return v.quantize((Decimal("0.01")))


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class LoanCreate(LoanBase):
    pass


# --------------------------------------------------
# UPDATE (Limited — can't change principal after creation)
# --------------------------------------------------
class LoanUpdate(BaseModel):
    status: Optional[LoanStatus] = None
    vehicle_id: Optional[uuid.UUID] = None
    principal: Optional[Decimal] = Field(None, gt=0)
    interest_rate: Optional[Decimal] = Field(None, gt=0, le=100)
    tenure: Optional[int] = Field(None, gt=0, le=360)


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class LoanResponse(LoanBase):
    id: uuid.UUID
    status: LoanStatus
    loan_number: str
    is_deleted: bool
    created_by_id: Optional[uuid.UUID]
    updated_by_id: Optional[uuid.UUID]

    # Computed fields
    monthly_interest: Optional[Decimal] = None
    total_payable: Optional[Decimal] = None

    model_config = {"from_attributes": True}


# --------------------------------------------------
# LIST RESPONSE
# --------------------------------------------------
class LoanListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[LoanResponse]
