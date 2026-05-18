import enum
import uuid
from typing import Optional, TYPE_CHECKING

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

if TYPE_CHECKING:
    from app.models.loan import Loan
    from app.models.document import Document


class StabilityDocType(str, enum.Enum):
    PROPERTY_TAX = "PROPERTY_TAX"
    ELECTRICITY_BILL = "ELECTRICITY_BILL"
    BANK_STATEMENT = "BANK_STATEMENT"
    CHEQUE_PDC = "CHEQUE_PDC"
    OTHER = "OTHER"


class StabilityDocument(AuditBase):
    __tablename__ = "stability_documents"

    # Mirrors the DB CHECK created in migration (same name → no ORM drift /
    # no spurious Alembic autogenerate diff). cheque_count is nullable;
    # NULL passes the CHECK by SQL semantics.
    __table_args__ = (
        CheckConstraint(
            "cheque_count >= 0", name="stability_documents_cheque_count_check"
        ),
    )

    loan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("loans.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    doc_subtype: Mapped[StabilityDocType] = mapped_column(
        Enum(StabilityDocType, name="stability_doc_type", create_type=False),
        nullable=False,
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cheque_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    document_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )

    loan: Mapped["Loan"] = relationship("Loan", foreign_keys=[loan_id])
    document: Mapped[Optional["Document"]] = relationship(
        "Document", foreign_keys=[document_id]
    )
