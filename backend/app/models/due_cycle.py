import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.loan import Loan
    from app.models.user import User


class CycleStatus(str, enum.Enum):
    UPCOMING = "UPCOMING"                # due date in the future, no activity yet
    AWAITING_REVIEW = "AWAITING_REVIEW"  # past due with shortfall; admin must classify
    PAID_ON_TIME = "PAID_ON_TIME"        # cycle fully met by due date
    LATE_PAYMENT = "LATE_PAYMENT"        # admin classified late; penalty applied
    MISSED_CAPPED = "MISSED_CAPPED"      # penalty hit cap; loan moved to BAD_DEBT_PROPOSED


class DueCycle(Base):
    """
    One row per (loan, cycle_number). Generated at loan approval.
    Tracks the per-month obligation: base EMI, accumulated penalty add-ons,
    payments received, and classification state.
    """

    __tablename__ = "due_cycles"

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
    loan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loans.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    cycle_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)

    # --------------------------------------------------
    # MONEY
    # --------------------------------------------------
    # The base EMI for this cycle (last cycle absorbs the rounding remainder).
    base_emi: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)

    # Accumulated additions from earlier late-payment events on this loan.
    addon_from_penalties: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        nullable=False,
        default=Decimal("0.00"),
        server_default="0.00",
    )

    # base_emi + addon_from_penalties; cached for fast queries.
    total_due: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)

    # Sum of transaction amounts allocated to this cycle.
    total_received: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        nullable=False,
        default=Decimal("0.00"),
        server_default="0.00",
    )

    # Cumulative penalty that has been charged ON this cycle (capped at late_amount).
    penalty_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        nullable=False,
        default=Decimal("0.00"),
        server_default="0.00",
    )

    # --------------------------------------------------
    # CLASSIFICATION
    # --------------------------------------------------
    cycle_status: Mapped[CycleStatus] = mapped_column(
        Enum(CycleStatus, name="cycle_status", create_type=False),
        default=CycleStatus.UPCOMING,
        server_default="UPCOMING",
        nullable=False,
    )

    # Date admin used as the "as-of" reference for penalty calculation.
    classified_as_of_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    classified_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    classified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    classification_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --------------------------------------------------
    # AUDIT BASE (not inheriting AuditBase because the FK names differ)
    # --------------------------------------------------
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    created_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    updated_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    deleted_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # --------------------------------------------------
    # RELATIONSHIPS
    # --------------------------------------------------
    loan: Mapped["Loan"] = relationship(
        "Loan", back_populates="due_cycles", foreign_keys=[loan_id], lazy="noload"
    )

    classified_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[classified_by_id], lazy="noload"
    )
