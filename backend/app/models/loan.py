import enum
import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Date, Enum, ForeignKey, Numeric, Integer, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.due_cycle import DueCycle
    from app.models.vehicle import Vehicle
    from app.models.transaction import Transaction
    from app.models.user import User


class LoanStatus(str, enum.Enum):
    DRAFT = "DRAFT"                          # created, not yet approved — no cycles, no disbursement
    ACTIVE = "ACTIVE"                        # approved and running
    AWAITING_CLOSURE = "AWAITING_CLOSURE"    # fully paid, admin must finalise closure
    CLOSED = "CLOSED"                        # admin-confirmed closure
    BAD_DEBT_PROPOSED = "BAD_DEBT_PROPOSED"  # auto-set at penalty cap, or employee-proposed
    BAD_DEBT = "BAD_DEBT"                    # admin/super-admin approved write-off


class Loan(AuditBase):
    __tablename__ = "loans"

    # --------------------------------------------------
    # RELATIONSHIPS KEYS
    # --------------------------------------------------
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    vehicle_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("vehicles.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # --------------------------------------------------
    # LOAN DETAILS
    # --------------------------------------------------
    loan_number: Mapped[str] = mapped_column(
        String(30), unique=True, nullable=False, index=True
    )

    # Financial terms are nullable so a DRAFT finance can be created before the
    # financial step of the New Finance wizard. They are mandatory (validated)
    # at approval — see services/loan.approve_loan.
    principal: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 2), nullable=True)

    interest_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)

    tenure: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # In months

    down_payment: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00"), server_default="0.00"
    )
    processing_fee: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00"), server_default="0.00"
    )
    documentation_fee: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00"), server_default="0.00"
    )

    # --------------------------------------------------
    # LIFECYCLE — penalty rate, approval, due day
    # --------------------------------------------------
    # Per-loan penalty rate (per-month %). Default 36 %. Admin can override.
    penalty_rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("36.00"),
        server_default="36.00",
    )

    # Set when admin approves a DRAFT loan. Immutable thereafter.
    approval_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Day-of-month (1-31) used to derive every cycle's due date.
    # NULL until approval; on approval set to approval_date.day.
    due_day_of_month: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)

    status: Mapped[LoanStatus] = mapped_column(
        Enum(LoanStatus, name="loan_status", create_type=False),
        default=LoanStatus.DRAFT,
        server_default="DRAFT",
        nullable=False,
    )

    # --------------------------------------------------
    # RELATIONSHIPS
    # --------------------------------------------------
    customer: Mapped["Customer"] = relationship(
        "Customer", back_populates="loans", foreign_keys=[customer_id], lazy="noload"
    )

    vehicle: Mapped[Optional["Vehicle"]] = relationship(
        "Vehicle", foreign_keys=[vehicle_id], lazy="noload"
    )

    transactions: Mapped[list["Transaction"]] = relationship(
        "Transaction",
        back_populates="loan",
        lazy="noload",
        primaryjoin="and_(Loan.id == Transaction.loan_id, Transaction.is_deleted == False)",
    )

    due_cycles: Mapped[list["DueCycle"]] = relationship(
        "DueCycle",
        back_populates="loan",
        lazy="noload",
        primaryjoin="and_(Loan.id == DueCycle.loan_id, DueCycle.is_deleted == False)",
        order_by="DueCycle.cycle_number",
    )

    created_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys="[Loan.created_by_id]", lazy="noload"
    )

    updated_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys="[Loan.updated_by_id]", lazy="noload"
    )
