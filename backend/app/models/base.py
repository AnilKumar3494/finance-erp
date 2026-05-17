import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.utils.time import utcnow


class AuditBase(Base):
    __abstract__ = True

    # --------------------------------------------------
    # PRIMARY KEY (UUID)
    # --------------------------------------------------
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,  # Python-side UUID (used by ORM before commit)
        server_default=text(
            "gen_random_uuid()"
        ),  # DB-side fallback (used for raw SQL / migrations)
    )

    # --------------------------------------------------
    # SOFT DELETE
    # --------------------------------------------------
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), index=True
    )

    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # --------------------------------------------------
    # TIMESTAMPS
    # --------------------------------------------------
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    # --------------------------------------------------
    # ACCOUNTABILITY
    # --------------------------------------------------
    created_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    updated_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    deleted_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # --------------------------------------------------
    # SOFT-DELETE HELPERS (single, centralized implementation)
    # --------------------------------------------------
    def soft_delete(self, by_id: Optional[uuid.UUID]) -> None:
        """Mark this row deleted. Atomically keeps is_deleted/deleted_at in sync."""
        self.is_deleted = True
        self.deleted_at = utcnow()
        self.deleted_by_id = by_id
        self.updated_by_id = by_id

    def restore(self, by_id: Optional[uuid.UUID]) -> None:
        """Reverse a soft delete. Clears deleted_at to satisfy the CHECK."""
        self.is_deleted = False
        self.deleted_at = None
        self.deleted_by_id = None
        self.updated_by_id = by_id
