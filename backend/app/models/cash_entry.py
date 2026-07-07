import enum
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import CheckConstraint, Date, Enum, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AuditBase


class CashEntryType(str, enum.Enum):
    CAPITAL_IN = "CAPITAL_IN"      # owner/partner money put in   (money in)
    OTHER_INCOME = "OTHER_INCOME"  # non-EMI income               (money in)
    EXPENSE = "EXPENSE"            # running costs                (money out)
    CAPITAL_OUT = "CAPITAL_OUT"    # owner withdrawals            (money out)


# Directions derived from the type — kept here so every consumer (day report,
# capital-expenses screen) classifies identically.
CASH_IN_TYPES = (CashEntryType.CAPITAL_IN, CashEntryType.OTHER_INCOME)
CASH_OUT_TYPES = (CashEntryType.EXPENSE, CashEntryType.CAPITAL_OUT)


class CashEntry(AuditBase):
    """
    Non-loan cash movement: capital in/out and expenses/other income.
    Completes the day-report cash book — loan money (collections and
    disbursements) lives on transactions/loans; everything else lives here.
    """

    __tablename__ = "cash_entries"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_cash_entries_amount_positive"),
    )

    entry_type: Mapped[CashEntryType] = mapped_column(
        Enum(CashEntryType, name="cash_entry_type", create_type=False),
        nullable=False,
    )

    # Business date (like transactions.effective_payment_date) — reports
    # bucket on this, not created_at.
    entry_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)

    # Free-text bucket ("Office rent", "Partner capital") — no lookup table so
    # the taxonomy can grow without schema changes.
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
