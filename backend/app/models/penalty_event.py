import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.due_cycle import DueCycle
    from app.models.loan import Loan
    from app.models.user import User


class PenaltyEvent(Base):
    """
    Immutable audit log of a penalty calculation.

    A reclassification does not edit a prior row — it creates a NEW row and
    sets the old row's `superseded_by_id` so the full history stays intact.
    Use the `superseded_by_id IS NULL` index to find the currently-active
    event for a cycle.
    """

    __tablename__ = "penalty_events"

    # --------------------------------------------------
    # PRIMARY KEY
    # --------------------------------------------------
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # --------------------------------------------------
    # OWNERSHIP
    # --------------------------------------------------
    due_cycle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("due_cycles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    loan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loans.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # --------------------------------------------------
    # INPUTS AT THE TIME OF CALCULATION
    # --------------------------------------------------
    late_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    days_late: Mapped[int] = mapped_column(Integer, nullable=False)
    days_in_due_month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    penalty_rate_snapshot: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)

    # --------------------------------------------------
    # OUTPUTS
    # --------------------------------------------------
    penalty_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    cap_hit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    spread_per_month: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    remaining_months_at_calc: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    # --------------------------------------------------
    # SUPERSESSION (chain for reclassification)
    # --------------------------------------------------
    superseded_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("penalty_events.id", ondelete="SET NULL"),
        nullable=True,
    )

    # --------------------------------------------------
    # AUDIT
    # --------------------------------------------------
    applied_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    classification_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # --------------------------------------------------
    # RELATIONSHIPS
    # --------------------------------------------------
    due_cycle: Mapped["DueCycle"] = relationship(
        "DueCycle", foreign_keys=[due_cycle_id], lazy="noload"
    )

    loan: Mapped["Loan"] = relationship(
        "Loan", foreign_keys=[loan_id], lazy="noload"
    )

    applied_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[applied_by_id], lazy="noload"
    )
