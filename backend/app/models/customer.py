import uuid
from typing import Optional, TYPE_CHECKING

import datetime
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

# Only imported during type checking — avoids circular imports at runtime
if TYPE_CHECKING:
    from app.models.user import User
    from app.models.loan import Loan
    from app.models.document import Document


class Customer(AuditBase):
    __tablename__ = "customers"

    # --------------------------------------------------
    # PERSONAL INFO
    # --------------------------------------------------
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)

    mobile_number: Mapped[str] = mapped_column(String(15), nullable=False, index=True)

    aadhaar_number: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)

    pan_number: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    date_of_birth: Mapped[Optional[datetime.date]] = mapped_column(nullable=True)

    alt_mobile_number: Mapped[Optional[str]] = mapped_column(String(15), nullable=True)

    address_line_1: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    address_line_2: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    mandal_village: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    pincode: Mapped[Optional[str]] = mapped_column(String(6), nullable=True)

    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --------------------------------------------------
    # IDEMPOTENCY
    # --------------------------------------------------
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # --------------------------------------------------
    # ASSIGNMENT
    # --------------------------------------------------
    assigned_employee_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # --------------------------------------------------
    # RELATIONSHIPS
    # --------------------------------------------------
    assigned_employee: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[assigned_employee_id], backref="assigned_customers"
    )

    loans: Mapped[list["Loan"]] = relationship(
        "Loan",
        back_populates="customer",
        lazy="selectin",
        primaryjoin="and_(Customer.id == Loan.customer_id, Loan.is_deleted == False)",
    )

    documents: Mapped[list["Document"]] = relationship(
        "Document",
        back_populates="customer",
        lazy="selectin",
        primaryjoin="and_(Customer.id == Document.customer_id, Document.is_deleted == False)",
    )
