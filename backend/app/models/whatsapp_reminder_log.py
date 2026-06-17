import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ReminderStatus(str, enum.Enum):
    SENT = "SENT"          # provider accepted the message
    FAILED = "FAILED"      # provider rejected / network error — retried next run
    SKIPPED = "SKIPPED"    # gated out (no consent, no phone, etc.) — diagnostic
    DRY_RUN = "DRY_RUN"    # rendered + logged but not sent (WHATSAPP_DRY_RUN)


class WhatsAppReminderLog(Base):
    """
    One row per reminder send attempt.

    Doubles as the idempotency ledger: the partial unique index on
    (due_cycle_id, offset_days) for SENT/DRY_RUN rows guarantees a cycle never
    gets the same reminder twice. FAILED/SKIPPED rows are outside the index so
    a transient failure can be retried on the next run.
    """

    __tablename__ = "whatsapp_reminder_log"
    __table_args__ = (
        CheckConstraint(
            "status IN ('SENT', 'FAILED', 'SKIPPED', 'DRY_RUN')",
            name="ck_whatsapp_reminder_status",
        ),
        Index(
            "uq_whatsapp_reminder_cycle_offset",
            "due_cycle_id",
            "offset_days",
            unique=True,
            postgresql_where=text("status IN ('SENT', 'DRY_RUN')"),
        ),
        Index("ix_whatsapp_reminder_created_at", text("created_at DESC")),
        Index("ix_whatsapp_reminder_customer", "customer_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )

    due_cycle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("due_cycles.id", ondelete="CASCADE"),
        nullable=False,
    )
    loan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("loans.id", ondelete="CASCADE"), nullable=False
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
    )

    offset_days: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    provider_message_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
