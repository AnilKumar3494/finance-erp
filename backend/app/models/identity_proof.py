import enum
import uuid
from typing import Optional, TYPE_CHECKING

from sqlalchemy import CheckConstraint, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.personnel import Personnel
    from app.models.document import Document


class IdentityProofType(str, enum.Enum):
    AADHAAR = "AADHAAR"
    PAN = "PAN"
    DRIVING_LICENSE = "DRIVING_LICENSE"
    RATION_CARD = "RATION_CARD"
    VOTER_ID = "VOTER_ID"
    MGNREGA_CARD = "MGNREGA_CARD"
    OTHER = "OTHER"


class IdentityProof(AuditBase):
    __tablename__ = "identity_proofs"

    __table_args__ = (
        CheckConstraint(
            "(customer_id IS NOT NULL AND personnel_id IS NULL) OR "
            "(customer_id IS NULL AND personnel_id IS NOT NULL)",
            name="ck_identity_proof_owner",
        ),
    )

    customer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    personnel_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("personnel.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    proof_type: Mapped[IdentityProofType] = mapped_column(
        Enum(IdentityProofType, name="identity_proof_type", create_type=False),
        nullable=False,
    )
    id_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    document_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )

    customer: Mapped[Optional["Customer"]] = relationship(
        "Customer", foreign_keys=[customer_id]
    )
    personnel: Mapped[Optional["Personnel"]] = relationship(
        "Personnel", foreign_keys=[personnel_id]
    )
    document: Mapped[Optional["Document"]] = relationship(
        "Document", foreign_keys=[document_id]
    )
