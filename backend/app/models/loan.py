import enum
import uuid
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Enum, ForeignKey, Numeric, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.vehicle import Vehicle
    from app.models.transaction import Transaction


class LoanStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    CLOSED = "CLOSED"
    BAD_DEBT = "BAD_DEBT"


class Loan(AuditBase):
    __tablename__ = "loans"

    # --------------------------------------------------
    # RELATIONSHIPS KEYS
    # --------------------------------------------------
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
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

    principal: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)

    interest_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)

    tenure: Mapped[int] = mapped_column(Integer, nullable=False)  # In months

    status: Mapped[LoanStatus] = mapped_column(
        Enum(LoanStatus, name="loan_status", create_type=False),
        default=LoanStatus.ACTIVE,
        server_default="ACTIVE",
        nullable=False,
    )

    # --------------------------------------------------
    # RELATIONSHIPS
    # --------------------------------------------------
    customer: Mapped["Customer"] = relationship(
        "Customer", back_populates="loans", foreign_keys=[customer_id]
    )

    vehicle: Mapped[Optional["Vehicle"]] = relationship(
        "Vehicle", foreign_keys=[vehicle_id]
    )

    transactions: Mapped[list["Transaction"]] = relationship(
        "Transaction",
        back_populates="loan",
        primaryjoin="and_(Loan.id == Transaction.loan_id, Transaction.is_deleted == False)",
    )
