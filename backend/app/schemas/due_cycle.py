import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from app.models.due_cycle import CycleStatus


# --------------------------------------------------
# RESPONSE — cycle
# --------------------------------------------------
class DueCycleResponse(BaseModel):
    id: uuid.UUID
    loan_id: uuid.UUID
    cycle_number: int
    due_date: date

    base_emi: Decimal
    addon_from_penalties: Decimal
    total_due: Decimal
    total_received: Decimal
    penalty_amount: Decimal

    cycle_status: CycleStatus
    classified_as_of_date: Optional[date] = None
    classified_by_id: Optional[uuid.UUID] = None
    classified_at: Optional[datetime] = None
    classification_note: Optional[str] = None

    # Computed field — convenient for the UI so it doesn't have to subtract
    shortfall: Decimal = Decimal("0.00")

    model_config = {"from_attributes": True}


# --------------------------------------------------
# RESPONSE — penalty event (returned alongside the cycle when LATE_PAYMENT)
# --------------------------------------------------
class PenaltyEventResponse(BaseModel):
    id: uuid.UUID
    due_cycle_id: uuid.UUID
    loan_id: uuid.UUID

    late_amount: Decimal
    days_late: int
    days_in_due_month: int
    penalty_rate_snapshot: Decimal

    penalty_amount: Decimal
    cap_hit: bool
    spread_per_month: Decimal
    remaining_months_at_calc: int

    superseded_by_id: Optional[uuid.UUID] = None
    applied_by_id: Optional[uuid.UUID] = None
    classification_note: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# --------------------------------------------------
# REQUEST — classify a cycle
# --------------------------------------------------
class CycleClassifyRequest(BaseModel):
    """
    Admin classification of a due-cycle.

    Allowed values for `cycle_status`:
      - PAID_ON_TIME   — only valid when the cycle has zero shortfall.
      - LATE_PAYMENT   — requires `classified_as_of_date` strictly after the
                         cycle's due date (drives penalty).

    Marking a cycle PAID_ON_TIME ignores `classified_as_of_date`.
    """

    cycle_status: CycleStatus = Field(
        ..., description="PAID_ON_TIME or LATE_PAYMENT"
    )
    classified_as_of_date: Optional[date] = Field(
        None,
        description="Date used as 'as-of' for penalty calc. Required for LATE_PAYMENT.",
    )
    classification_note: Optional[str] = Field(
        None, max_length=2000, description="Optional admin remarks."
    )

    @model_validator(mode="after")
    def validate_combo(self) -> "CycleClassifyRequest":
        if self.cycle_status not in (CycleStatus.PAID_ON_TIME, CycleStatus.LATE_PAYMENT):
            raise ValueError(
                "cycle_status must be PAID_ON_TIME or LATE_PAYMENT for classification"
            )
        if (
            self.cycle_status == CycleStatus.LATE_PAYMENT
            and self.classified_as_of_date is None
        ):
            raise ValueError(
                "classified_as_of_date is required when cycle_status is LATE_PAYMENT"
            )
        return self


# --------------------------------------------------
# RESPONSE — wraps cycle + (optional) penalty event from the classify call
# --------------------------------------------------
class CycleClassifyResponse(BaseModel):
    cycle: DueCycleResponse
    penalty_event: Optional[PenaltyEventResponse] = None


# --------------------------------------------------
# RESPONSE — list of cycles for a loan
# --------------------------------------------------
class DueCycleListResponse(BaseModel):
    loan_id: uuid.UUID
    total: int
    cycles: list[DueCycleResponse]
