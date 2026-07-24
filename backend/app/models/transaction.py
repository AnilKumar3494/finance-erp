import enum
import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import CheckConstraint, Date, Enum, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

if TYPE_CHECKING:
    from app.models.due_cycle import DueCycle
    from app.models.loan import Loan
    from app.models.user import User


class PaymentMethod(str, enum.Enum):
    CASH = "CASH"
    GPAY = "GPAY"
    PHONEPE = "PHONEPE"
    BANK_TRANSFER = "BANK_TRANSFER"
    # Catch-all for modes that don't fit the four named buckets (third-party
    # UPI handles, IMPS/NEFT, cheque). Added in migration 015. The Notes
    # field on the transaction captures the specifics.
    OTHER = "OTHER"


class TransactionStatus(str, enum.Enum):
    PENDING = "PENDING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"


class TransactionType(str, enum.Enum):
    REGULAR = "REGULAR"
    DOWN_PAYMENT = "DOWN_PAYMENT"


class PunctualityStatus(str, enum.Enum):
    AWAITING_REVIEW = "AWAITING_REVIEW"  # default; admin has not classified yet
    PAID_ON_TIME = "PAID_ON_TIME"        # only allowed when the cycle's shortfall = 0
    LATE_PAYMENT = "LATE_PAYMENT"        # admin marks late; effective_payment_date drives penalty


class Transaction(AuditBase):
    __tablename__ = "transactions"

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
        CheckConstraint("ta_amount >= 0", name="ck_transactions_ta_amount_nonneg"),
    )

    # --------------------------------------------------
    # FOREIGN KEYS
    # --------------------------------------------------
    loan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("loans.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    collected_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Which due-cycle this payment counts toward. Auto-set from
    # effective_payment_date vs each cycle's due_date; admin may override.
    due_cycle_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("due_cycles.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # --------------------------------------------------
    # TRANSACTION DETAILS
    # --------------------------------------------------
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)

    # Travelling Allowance — a per-visit collection charge (usually Rs.200) taken
    # ALONGSIDE the EMI (mirrors iFinance's taHPReceipts). Separate income: it does
    # NOT reduce the loan balance or count as EMI collection; reports sum it apart.
    ta_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0"), server_default="0"
    )

    payment_mode: Mapped[PaymentMethod] = mapped_column(
        Enum(PaymentMethod, name="payment_method", create_type=False), nullable=False
    )

    status: Mapped[TransactionStatus] = mapped_column(
        Enum(TransactionStatus, name="transaction_status", create_type=False),
        default=TransactionStatus.PENDING,
        server_default="PENDING",
        nullable=False,
    )

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    transaction_type: Mapped[TransactionType] = mapped_column(
        Enum(TransactionType, name="transaction_type", create_type=False),
        default=TransactionType.REGULAR,
        server_default="REGULAR",
        nullable=False,
    )

    idempotency_key: Mapped[Optional[str]] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )

    # --------------------------------------------------
    # LIFECYCLE — effective date + punctuality classification
    # --------------------------------------------------
    # The "true" payment date. Admin can edit it (e.g. cash received earlier
    # than entered in the system). Drives cycle allocation and penalty calc.
    effective_payment_date: Mapped[date] = mapped_column(Date, nullable=False)

    punctuality_status: Mapped[PunctualityStatus] = mapped_column(
        Enum(PunctualityStatus, name="punctuality_status", create_type=False),
        default=PunctualityStatus.AWAITING_REVIEW,
        server_default="AWAITING_REVIEW",
        nullable=False,
    )

    # --------------------------------------------------
    # RELATIONSHIPS
    # --------------------------------------------------
    loan: Mapped["Loan"] = relationship(
        "Loan", foreign_keys=[loan_id], back_populates="transactions"
    )

    collected_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[collected_by_id]
    )

    due_cycle: Mapped[Optional["DueCycle"]] = relationship(
        "DueCycle", foreign_keys=[due_cycle_id], lazy="noload"
    )
