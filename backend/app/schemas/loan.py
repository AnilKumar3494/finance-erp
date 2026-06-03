import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.loan import LoanStatus
from app.models.transaction import PaymentMethod
from app.models.user import UserRole


# --------------------------------------------------
# NESTED SCHEMAS (Lightweight — for includes)
# --------------------------------------------------
class UserNested(BaseModel):
    """Lightweight user info for nesting in responses"""

    id: uuid.UUID
    username: str
    full_name: Optional[str] = None
    role: UserRole

    model_config = {"from_attributes": True}


class CustomerNested(BaseModel):
    """Lightweight customer info for nesting in responses"""

    id: uuid.UUID
    full_name: str
    mobile_number: str
    assigned_employee_id: Optional[uuid.UUID] = None

    model_config = {"from_attributes": True}


class VehicleNested(BaseModel):
    """Lightweight vehicle info for nesting in responses"""

    id: uuid.UUID
    plate_number: str
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None

    model_config = {"from_attributes": True}


# --------------------------------------------------
# BASE
# --------------------------------------------------
class LoanBase(BaseModel):
    customer_id: uuid.UUID
    vehicle_id: Optional[uuid.UUID] = None
    # Financial terms are optional: a DRAFT loan may be created before they're
    # entered (New Finance wizard). They become mandatory at approval — see
    # services/loan.approve_loan.
    principal: Optional[Decimal] = Field(
        default=None, gt=0, description="Loan amount must be positive"
    )
    interest_rate: Optional[Decimal] = Field(
        default=None, gt=0, le=100, description="Annual interest rate"
    )
    tenure: Optional[int] = Field(
        default=None, gt=0, le=360, description="Tenure in months"
    )
    down_payment: Decimal = Field(default=Decimal("0.00"), ge=0)
    processing_fee: Decimal = Field(default=Decimal("0.00"), ge=0)
    documentation_fee: Decimal = Field(default=Decimal("0.00"), ge=0)

    @field_validator("principal")
    @classmethod
    def validate_principal(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is None:
            return v
        if v <= 0:
            raise ValueError("Principal must be greater than 0")
        return v.quantize((Decimal("0.01")))

    @field_validator("interest_rate")
    @classmethod
    def validate_interest_rate(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is None:
            return v
        if v <= 0 or v > 100:
            raise ValueError("Interest rate must be between 0 and 100")
        return v.quantize((Decimal("0.01")))


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class LoanCreate(LoanBase):
    # Kept for backwards compatibility with the existing frontend. The mode
    # is now actually consumed at the approval step, not at create — but if
    # the caller provides it here we accept and persist it (it gets passed
    # to /approve via the UI flow).
    down_payment_mode: Optional[PaymentMethod] = None

    # Per-loan penalty rate override (default 36% from DB). Admin/Super-Admin.
    penalty_rate: Optional[Decimal] = Field(
        None,
        ge=0,
        le=1000,
        description="Per-month penalty rate. Defaults to 36%.",
    )

    @model_validator(mode="after")
    def validate_down_payment_mode(self) -> "LoanCreate":
        if self.down_payment and self.down_payment > 0 and not self.down_payment_mode:
            raise ValueError("down_payment_mode is required when down_payment > 0")
        return self

    @model_validator(mode="after")
    def validate_down_payment_below_principal(self) -> "LoanCreate":
        if (
            self.down_payment is not None
            and self.principal is not None
            and self.down_payment >= self.principal
        ):
            raise ValueError("Down payment must be strictly less than principal")
        return self


# --------------------------------------------------
# APPROVE
# --------------------------------------------------
class LoanApproveRequest(BaseModel):
    """
    Body for POST /loans/{id}/approve.
    `down_payment_mode` is required only if the loan has a down_payment > 0.
    """

    down_payment_mode: Optional[PaymentMethod] = None


# --------------------------------------------------
# UPDATE (Limited — can't change principal after creation)
# --------------------------------------------------
class LoanUpdate(BaseModel):
    status: Optional[LoanStatus] = None
    vehicle_id: Optional[uuid.UUID] = None
    principal: Optional[Decimal] = Field(None, gt=0)
    interest_rate: Optional[Decimal] = Field(None, gt=0, le=100)
    tenure: Optional[int] = Field(None, gt=0, le=360)
    down_payment: Optional[Decimal] = Field(None, ge=0)
    processing_fee: Optional[Decimal] = Field(None, ge=0)
    documentation_fee: Optional[Decimal] = Field(None, ge=0)
    penalty_rate: Optional[Decimal] = Field(None, ge=0, le=1000)

    model_config = {"extra": "forbid"}


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class LoanResponse(LoanBase):
    id: uuid.UUID
    status: LoanStatus
    loan_number: str
    is_deleted: bool
    created_by_id: Optional[uuid.UUID] = None
    updated_by_id: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime

    # Lifecycle (populated after approval)
    penalty_rate: Optional[Decimal] = None
    approval_date: Optional[date] = None
    due_day_of_month: Optional[int] = None

    # Computed fields
    monthly_interest: Optional[Decimal] = None
    total_payable: Optional[Decimal] = None
    net_loan_principal: Optional[Decimal] = None
    net_disbursed_amount: Optional[Decimal] = None

    # Nested objects (populated only when ?include= is used)
    customer: Optional[CustomerNested] = None
    vehicle: Optional[VehicleNested] = None
    created_by: Optional[UserNested] = None
    updated_by: Optional[UserNested] = None

    model_config = {"from_attributes": True}


# --------------------------------------------------
# LIST RESPONSE
# --------------------------------------------------
class LoanListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[LoanResponse]
