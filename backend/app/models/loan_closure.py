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
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.document import Document
    from app.models.loan import Loan
    from app.models.user import User


class ClosureType(str, enum.Enum):
    NORMAL_TENURE = "NORMAL_TENURE"                  # fully repaid over the original schedule
    EARLY_FORECLOSURE = "EARLY_FORECLOSURE"          # customer paid full outstanding before tenure end
    NEGOTIATED_SETTLEMENT = "NEGOTIATED_SETTLEMENT"  # partial recovery agreed with customer
    WRITE_OFF = "WRITE_OFF"                          # bad debt approved, no recovery


class LoanClosure(Base):
    """
    One row per closure attempt. If a super-admin reverses a closure, the old
    row stays (audit) and `superseded_by_id` points to the replacement.

    The partial unique index `uq_loan_closures_loan_active` enforces at most
    one currently-active closure per loan.
    """

    __tablename__ = "loan_closures"

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

    # --------------------------------------------------
    # CLOSURE DETAILS
    # --------------------------------------------------
    closure_type: Mapped[ClosureType] = mapped_column(
        Enum(ClosureType, name="closure_type", create_type=False), nullable=False
    )

    closing_charges: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00"), server_default="0.00"
    )
    charge_waived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    waiver_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    final_settlement_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False
    )

    outstanding_at_closure: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False
    )

    amount_written_off: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00"), server_default="0.00"
    )

    refund_due_to_customer: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00"), server_default="0.00"
    )

    refund_status: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    closure_date: Mapped[date] = mapped_column(Date, nullable=False)

    noc_issued: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    noc_reference: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    closure_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    supporting_document_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )

    closed_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=False,
    )

    superseded_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loan_closures.id", ondelete="SET NULL"),
        nullable=True,
    )

    # --------------------------------------------------
    # AUDIT (not inheriting AuditBase: loan_closures table has its own col layout)
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
        "Loan", foreign_keys=[loan_id], lazy="noload"
    )

    closed_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[closed_by_id], lazy="noload"
    )

    supporting_document: Mapped[Optional["Document"]] = relationship(
        "Document", foreign_keys=[supporting_document_id], lazy="noload"
    )
