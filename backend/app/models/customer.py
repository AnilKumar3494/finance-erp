import uuid
from typing import Optional, TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

# Only imported during type checking — avoids circular imports at runtime
if TYPE_CHECKING:
    from app.models.user import User
    from app.models.loan import Loan

# from app.models.document import Document


class Customer(AuditBase):
    __tablename__ = "customers"

    # --------------------------------------------------
    # PERSONAL INFO
    # --------------------------------------------------
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)

    mobile_number: Mapped[str] = mapped_column(
        String(15), unique=True, nullable=False, index=True
    )

    aadhaar_number: Mapped[Optional[str]] = mapped_column(
        String(12), unique=True, nullable=True
    )

    pan_number: Mapped[Optional[str]] = mapped_column(
        String(10), unique=True, nullable=True
    )

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
        primaryjoin="and_(Customer.id == Loan.customer_id, Loan.is_deleted == False)",
    )

    # documents: Mapped[list["Document"]] = relationship(
    #     "Document",
    #     back_populates="customer",
    #     primaryjoin="and_(Customer.id == Document.customer_id, Document.is_deleted == False)",
    # )
