import enum
import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.loan import Loan
    from app.models.transaction import Transaction
    from app.models.user import User
    from app.models.vehicle import Vehicle


class DocCategory(str, enum.Enum):
    ARCHIVE = "ARCHIVE"
    KYC = "KYC"
    LOAN_AGREEMENT = "LOAN_AGREEMENT"
    RECEIPT = "RECEIPT"
    VEHICLE_IMAGE = "VEHICLE_IMAGE"


# AKTODO: when antivirus is wired, add a ScanStatus enum here.


class Document(AuditBase):
    __tablename__ = "documents"

    # Enforce that the right link is set per doc_type
    __table_args__ = (
        CheckConstraint(
            """
            (doc_type = 'KYC'            AND loan_id IS NULL AND transaction_id IS NULL AND vehicle_id IS NULL) OR
            (doc_type = 'LOAN_AGREEMENT' AND loan_id IS NOT NULL) OR
            (doc_type = 'RECEIPT'        AND transaction_id IS NOT NULL) OR
            (doc_type = 'VEHICLE_IMAGE'  AND vehicle_id IS NOT NULL) OR
            (doc_type = 'ARCHIVE')
            """,
            name="ck_documents_type_link_consistency",
        ),
    )

    # --------------------------------------------------
    # FOREIGN KEYS
    # --------------------------------------------------
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    loan_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("loans.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    transaction_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("transactions.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    vehicle_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("vehicles.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # --------------------------------------------------
    # DOCUMENT INFO
    # --------------------------------------------------
    file_hash: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )
    doc_type: Mapped[DocCategory] = mapped_column(
        Enum(DocCategory, name="doc_category", create_type=False), nullable=False
    )
    s3_key: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    content_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # AKTODO: add scan_status column once antivirus pipeline is wired up.

    # --------------------------------------------------
    # RELATIONSHIPS
    # --------------------------------------------------
    customer: Mapped["Customer"] = relationship(
        "Customer", back_populates="documents", foreign_keys=[customer_id]
    )
    loan: Mapped[Optional["Loan"]] = relationship("Loan", foreign_keys=[loan_id])
    transaction: Mapped[Optional["Transaction"]] = relationship(
        "Transaction", foreign_keys=[transaction_id]
    )
    vehicle: Mapped[Optional["Vehicle"]] = relationship(
        "Vehicle", foreign_keys=[vehicle_id]
    )

    uploaded_by: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys="Document.created_by_id",
        primaryjoin="Document.created_by_id == User.id",
    )
    deleted_by: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys="Document.deleted_by_id",
        primaryjoin="Document.deleted_by_id == User.id",
    )
