import enum
import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Enum, ForeignKey, String, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.user import User


class DocCategory(str, enum.Enum):
    ARCHIVE = "ARCHIVE"
    KYC = "KYC"
    LOAN_AGREEMENT = "LOAN_AGREEMENT"
    RECEIPT = "RECEIPT"
    VEHICLE_IMAGE = "VEHICLE_IMAGE"


class Document(AuditBase):
    __tablename__ = "documents"

    # --------------------------------------------------
    # FOREIGN KEYS
    # --------------------------------------------------
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
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

    # --------------------------------------------------
    # RELATIONSHIPS
    # --------------------------------------------------
    customer: Mapped["Customer"] = relationship(
        "Customer", back_populates="documents", foreign_keys=[customer_id]
    )

    # Who uploaded — links to created_by_id from AuditBase
    uploaded_by: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys="Document.created_by_id",  # reuse AuditBase field
        primaryjoin="Document.created_by_id == User.id",
    )

    deleted_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
