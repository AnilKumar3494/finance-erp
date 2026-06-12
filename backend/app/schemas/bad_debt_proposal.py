import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.models.bad_debt_proposal import BadDebtProposalStatus
from app.models.loan import LoanStatus


class BadDebtProposeRequest(BaseModel):
    """Body for POST /loans/{id}/bad-debt/propose."""

    proposed_reason: str = Field(..., min_length=10, max_length=4000)


class BadDebtReviewRequest(BaseModel):
    """Body for POST /bad-debt-proposals/{id}/review (admin/super-admin)."""

    decision: Literal["APPROVE", "REJECT"]
    review_notes: Optional[str] = Field(None, max_length=4000)


class BadDebtProposalResponse(BaseModel):
    id: uuid.UUID
    loan_id: uuid.UUID
    status: BadDebtProposalStatus

    proposed_reason: str
    proposed_by_id: Optional[uuid.UUID] = None
    proposed_at: datetime
    auto_proposed: bool

    reviewed_by_id: Optional[uuid.UUID] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BadDebtProposalListItem(BadDebtProposalResponse):
    """A proposal enriched with its loan + customer for the cross-loan review
    queue (Collections → Bad debt lens). Joined server-side so the admin sees
    who/what without a per-row lookup. Extends the base response, so existing
    consumers that read only the proposal fields keep working."""

    loan_number: str
    hp_number: Optional[str] = None
    loan_status: LoanStatus
    principal: Decimal
    customer_id: uuid.UUID
    customer_name: str
    customer_mobile: str


class BadDebtProposalListResponse(BaseModel):
    """Uniform paginated shape (G3) — `proposals` renamed to `results` so
    every list endpoint shares one envelope. Items carry the joined loan +
    customer fields (BadDebtProposalListItem)."""

    total: int
    page: int = 1
    page_size: int
    results: list[BadDebtProposalListItem]
