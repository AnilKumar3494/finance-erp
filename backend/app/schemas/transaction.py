import uuid
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field

from app.models.transaction import PaymentMethod, TransactionStatus


# --------------------------------------------------
# BASE
# --------------------------------------------------
class TransactionBase(BaseModel):
    loan_id: uuid.UUID
    amount: Decimal = Field(..., gt=0, description="Payment amount must be positive")
    payment_mode: PaymentMethod
    notes: Optional[str] = Field(None, max_length=255)


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class TransactionCreate(TransactionBase):
    pass


# --------------------------------------------------
# UPDATE (Only status and notes)
# --------------------------------------------------
class TransactionUpdate(BaseModel):
    status: Optional[TransactionStatus] = None
    notes: Optional[str] = Field(None, max_length=255)


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class TransactionResponse(TransactionBase):
    id: uuid.UUID
    status: TransactionStatus
    collected_by_id: Optional[uuid.UUID]
    is_deleted: bool
    created_by_id: Optional[uuid.UUID]
    updated_by_id: Optional[uuid.UUID]

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
    outstanding: Decimal
    transaction_count: int
