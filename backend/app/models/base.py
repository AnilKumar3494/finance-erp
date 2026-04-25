import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AuditBase(Base):
    __abstract__ = True

    # --------------------------------------------------
    # PRIMARY KEY (UUID)
    # --------------------------------------------------
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        # Python-side UUID (used by ORM before commit)
        default=uuid.uuid4,
        # DB-side fallback (used for raw SQL / migrations)
        server_default=text("gen_random_uuid()"),
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
        # Works for ORM updates
        onupdate=func.now(),
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
