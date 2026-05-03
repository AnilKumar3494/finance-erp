import enum
import uuid
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

if TYPE_CHECKING:
    from app.models.loan import Loan
    from app.models.user import User


class PaymentMethod(str, enum.Enum):
    CASH = "CASH"
    GPAY = "GPAY"
    PHONEPE = "PHONEPE"
    BANK_TRANSFER = "BANK_TRANSFER"


class TransactionStatus(str, enum.Enum):
    PENDING = "PENDING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"


class Transaction(AuditBase):
    __tablename__ = "transactions"

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
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

    # --------------------------------------------------
    # TRANSACTION DETAILS
    # --------------------------------------------------
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)

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

    idempotency_key: Mapped[Optional[str]] = mapped_column(
        String(64), unique=True, nullable=True, index=True
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
