import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from app.models.loan_closure import ClosureType


# --------------------------------------------------
# REQUEST — close a loan
# --------------------------------------------------
class LoanCloseRequest(BaseModel):
    """
    Body for POST /loans/{id}/close.

    Rules enforced here at the schema layer:
      - NORMAL_TENURE / EARLY_FORECLOSURE: outstanding must be 0 (checked in service).
      - NEGOTIATED_SETTLEMENT: amount_written_off >= 0; final_settlement_amount must be set.
      - WRITE_OFF: amount_written_off = outstanding_at_closure; closing_charges = 0.
      - charge_waived requires a waiver_reason.
      - noc_issued requires a noc_reference.
    """

    closure_type: ClosureType
    closing_charges: Decimal = Field(default=Decimal("0.00"), ge=0)
    charge_waived: bool = False
    waiver_reason: Optional[str] = Field(None, max_length=2000)

    final_settlement_amount: Decimal = Field(..., ge=0)
    amount_written_off: Decimal = Field(default=Decimal("0.00"), ge=0)

    refund_due_to_customer: Decimal = Field(default=Decimal("0.00"), ge=0)
    refund_status: Optional[str] = Field(None, max_length=30)

    closure_date: Optional[date] = Field(
        None, description="Effective date of closure. Defaults to today."
    )

    noc_issued: bool = False
    noc_reference: Optional[str] = Field(None, max_length=100)

    closure_remarks: Optional[str] = Field(None, max_length=4000)
    supporting_document_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def _validate(self) -> "LoanCloseRequest":
        if self.charge_waived and not self.waiver_reason:
            raise ValueError("waiver_reason is required when charge_waived is True")
        if self.charge_waived and self.closing_charges and self.closing_charges > 0:
            raise ValueError(
                "closing_charges must be 0 when charge_waived is True"
            )
        if self.noc_issued and not self.noc_reference:
            raise ValueError("noc_reference is required when noc_issued is True")
        if self.closure_type == ClosureType.WRITE_OFF and self.closing_charges and self.closing_charges > 0:
            raise ValueError("closing_charges must be 0 for WRITE_OFF closures")
        return self


# --------------------------------------------------
# RESPONSE — closure record
# --------------------------------------------------
class LoanClosureResponse(BaseModel):
    id: uuid.UUID
    loan_id: uuid.UUID
    closure_type: ClosureType

    closing_charges: Decimal
    charge_waived: bool
    waiver_reason: Optional[str] = None

    final_settlement_amount: Decimal
    outstanding_at_closure: Decimal
    amount_written_off: Decimal

    refund_due_to_customer: Decimal
    refund_status: Optional[str] = None

    closure_date: date
    noc_issued: bool
    noc_reference: Optional[str] = None

    closure_remarks: Optional[str] = None
    supporting_document_id: Optional[uuid.UUID] = None

    closed_by_id: uuid.UUID
    superseded_by_id: Optional[uuid.UUID] = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
