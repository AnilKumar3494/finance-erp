import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class WhatsAppSettings(Base):
    """
    Singleton config row for WhatsApp EMI reminders. Edited from the admin UI.

    Only one row ever exists (enforced by the `singleton` unique+check column).
    Read it with `WhatsAppSettings.get(db)`.
    """

    __tablename__ = "whatsapp_settings"
    __table_args__ = (
        CheckConstraint("singleton = 1", name="ck_whatsapp_settings_singleton"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # One-row guard. Always 1.
    singleton: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, unique=True, server_default="1", default=1
    )

    # Runtime master switch the admin UI toggles (no redeploy to pause).
    reminders_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )

    # The Meta-approved template this maps to + editable preview copy. Changing
    # the WORDING requires re-submitting the template to Meta; the preview is
    # for the UI/audit, not sent verbatim.
    template_name: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="emi_reminder", default="emi_reminder"
    )
    template_language: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="en", default="en"
    )
    template_body_preview: Mapped[str] = mapped_column(Text, nullable=False)

    # Days-before-due-date to send (e.g. [7, 3]).
    reminder_offsets_days: Mapped[list[int]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[7, 3]'::jsonb")
    )

    send_hour: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default="9", default=9
    )
    send_minute: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default="0", default=0
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    @classmethod
    def get(cls, db) -> "WhatsAppSettings":
        """Return the singleton row (migration 017 seeds it)."""
        return db.query(cls).filter(cls.singleton == 1).first()
