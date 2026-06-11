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

    # Required: every payment must be allocated to a cycle. The FE seeds this
    # with the worst-unpaid cycle (or the next UPCOMING one) so the dropdown
    # is always pre-selected — admin just confirms or changes the pick. The
    # earlier "leave it blank and the system picks" path was a UX trap: it
    # let admins silently produce NULL-cycle SUCCESS transactions that
    # bypassed the cycle ledger entirely. See PR / commit history.
    due_cycle_id: uuid.UUID = Field(
        ...,
        description="Cycle to allocate this payment to. Required.",
    )


# --------------------------------------------------
# UPDATE
# --------------------------------------------------
# All fields optional — the service applies only what's actually present in
# the payload (model_dump(exclude_unset=True)). Status changes still go
# through /confirm or /fail. Editing a SUCCESS transaction is gated to admins
# at the route level; PENDING/FAILED edits are open to any user in scope of
# the loan so a misclick on the field can be corrected without admin help.
class TransactionUpdate(BaseModel):
    notes: Optional[str] = Field(None, max_length=1000)
    due_cycle_id: Optional[uuid.UUID] = Field(
        None,
        description="Reallocate this payment to a different cycle on the same loan.",
    )
    amount: Optional[Decimal] = Field(
        None,
        gt=0,
        max_digits=15,
        decimal_places=2,
        description="Correct the recorded amount.",
    )
    effective_payment_date: Optional[date] = Field(
        None,
        description="Correct the date the customer actually paid.",
    )
    payment_mode: Optional[PaymentMethod] = Field(
        None,
        description="Correct the payment mode (CASH / GPAY / etc.).",
    )


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


# --------------------------------------------------
# PENDING CONFIRMATIONS WORKLIST
# Cross-loan list of PENDING transactions awaiting an admin's confirm/fail,
# joined to loan + customer (+ the allocated cycle) so the Collections &
# Actions surface can show who/what without a per-row lookup.
# --------------------------------------------------
class PendingConfirmationItem(BaseModel):
    id: uuid.UUID  # transaction id
    loan_id: uuid.UUID
    loan_number: str

    customer_id: uuid.UUID
    customer_name: str
    customer_mobile: str

    amount: Decimal
    payment_mode: PaymentMethod
    effective_payment_date: date
    collected_by_id: Optional[uuid.UUID] = None
    created_at: datetime

    # Allocated cycle (left-joined; legacy rows may be unallocated)
    due_cycle_id: Optional[uuid.UUID] = None
    cycle_number: Optional[int] = None
    cycle_due_date: Optional[date] = None


class PendingConfirmationListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    total_pending_amount: Decimal
    results: list[PendingConfirmationItem]
