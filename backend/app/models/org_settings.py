import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, SmallInteger, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class OrgSettings(Base):
    """
    Single-row organisation branding for this deployment (migration 025).

    Not an AuditBase: there is exactly one row (id pinned to 1), it is never
    soft-deleted, and changes are recorded in audit_logs instead. No row means
    "use the ORG_DISPLAY_NAME / ORG_SHORT_NAME env defaults".
    """

    __tablename__ = "org_settings"
    __table_args__ = (CheckConstraint("id = 1", name="org_settings_id_check"),)

    id: Mapped[int] = mapped_column(
        SmallInteger, primary_key=True, default=1, server_default=text("1")
    )
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    short_name: Mapped[str] = mapped_column(String(30), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
