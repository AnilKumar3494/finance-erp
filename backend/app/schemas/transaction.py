import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field

from app.models.transaction import (
    PaymentMethod,
    PunctualityStatus,
    TransactionStatus,
    TransactionType,
)


# --------------------------------------------------
# BASE
# --------------------------------------------------
class TransactionBase(BaseModel):
    loan_id: uuid.UUID
    amount: Decimal = Field(
        ...,
        gt=0,
        max_digits=15,
        decimal_places=2,
        description="Payment amount must be positive",
    )
    payment_mode: PaymentMethod
    notes: Optional[str] = Field(None, max_length=1000)


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class TransactionCreate(TransactionBase):
    collected_by_id: Optional[uuid.UUID] = Field(
        None, description="Defaults to current user if not provided"
    )
    idempotency_key: Optional[str] = Field(
        None,
        max_length=64,
        description="Client-generated key to prevent duplicate submissions",
    )

    # When the customer actually paid. Used to allocate the payment to the
    # correct due-cycle and (later) compute days_late. Defaults to today.
    effective_payment_date: Optional[date] = Field(
        None,
        description="Actual payment date; defaults to today. Drives cycle allocation.",
    )

    # Optional admin override for cycle allocation. If omitted, the system
    # picks the earliest cycle whose due_date >= effective_payment_date.
    due_cycle_id: Optional[uuid.UUID] = Field(
        None,
        description="Admin-only override. Force the payment to a specific cycle.",
    )


# --------------------------------------------------
# UPDATE (Notes only — status changes via /confirm or /fail)
# --------------------------------------------------
class TransactionUpdate(BaseModel):
    notes: Optional[str] = Field(None, max_length=1000)


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class TransactionResponse(TransactionBase):
    id: uuid.UUID
    status: TransactionStatus
    transaction_type: TransactionType
    collected_by_id: Optional[uuid.UUID]
    is_deleted: bool
    created_by_id: Optional[uuid.UUID]
    updated_by_id: Optional[uuid.UUID]
    idempotency_key: Optional[str] = None

    # Lifecycle fields (NEW)
    effective_payment_date: date
    punctuality_status: PunctualityStatus
    due_cycle_id: Optional[uuid.UUID] = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --------------------------------------------------
# LIST RESPONSE
# --------------------------------------------------
class TransactionListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    total_collected: Decimal
    results: list[TransactionResponse]


# --------------------------------------------------
# LOAN SUMMARY (Outstanding balance)
# --------------------------------------------------
class LoanTransactionSummary(BaseModel):
    loan_id: uuid.UUID
    principal: Decimal
    total_payable: Decimal
    total_paid: Decimal
    total_pending: Decimal
    outstanding: Decimal
    transaction_count: int
