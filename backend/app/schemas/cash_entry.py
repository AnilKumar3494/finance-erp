import uuid
from datetime import date as date_type, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.cash_entry import CashEntryType


class CashEntryCreate(BaseModel):
    entry_type: CashEntryType
    entry_date: date_type
    amount: Decimal = Field(gt=0)
    category: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("category", "notes")
    @classmethod
    def _strip_to_none(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


class CashEntryUpdate(BaseModel):
    entry_type: Optional[CashEntryType] = None
    entry_date: Optional[date_type] = None
    amount: Optional[Decimal] = Field(None, gt=0)
    category: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("category", "notes")
    @classmethod
    def _strip_to_none(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


class CashEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    entry_type: CashEntryType
    entry_date: date_type
    amount: Decimal
    category: Optional[str]
    notes: Optional[str]
    created_at: datetime
    created_by_id: Optional[uuid.UUID]


class CashEntryListResponse(BaseModel):
    total: int
    # Period rollups over the filtered window (not just the returned rows).
    total_in: Decimal
    total_out: Decimal
    capital_in: Decimal
    other_income: Decimal
    expenses: Decimal
    capital_out: Decimal
    results: list[CashEntryResponse]
