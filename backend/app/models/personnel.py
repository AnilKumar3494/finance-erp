import enum
import uuid
from datetime import date
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Date, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

if TYPE_CHECKING:
    from app.models.loan import Loan


class PersonnelRole(str, enum.Enum):
    GUARANTOR = "GUARANTOR"
    CO_HIRER = "CO_HIRER"


class Personnel(AuditBase):
    __tablename__ = "personnel"

    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    mobile_number: Mapped[str] = mapped_column(
        String(15), unique=True, nullable=False, index=True
    )
    alt_mobile_number: Mapped[Optional[str]] = mapped_column(String(15), nullable=True)
    aadhaar_number: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    pan_number: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    address_line_1: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    address_line_2: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    mandal_village: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    loan_associations: Mapped[list["LoanPersonnel"]] = relationship(
        "LoanPersonnel",
        back_populates="personnel",
        primaryjoin="and_(Personnel.id == LoanPersonnel.personnel_id, LoanPersonnel.is_deleted == False)",
    )


class LoanPersonnel(AuditBase):
    __tablename__ = "loan_personnel"

    loan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("loans.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    personnel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("personnel.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    role: Mapped[PersonnelRole] = mapped_column(
        Enum(PersonnelRole, name="personnel_role", create_type=False), nullable=False
    )
    relationship_to_hirer: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )

    personnel: Mapped["Personnel"] = relationship(
        "Personnel",
        back_populates="loan_associations",
        foreign_keys=[personnel_id],
    )
    loan: Mapped["Loan"] = relationship("Loan", foreign_keys=[loan_id])
