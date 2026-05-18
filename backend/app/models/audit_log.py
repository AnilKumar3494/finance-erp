"""
AuditLog model — maps to the existing `audit_logs` table.

This table is append-only by design (no soft-delete, no updates). It records
every privileged action across the system: logins, lockouts, user CRUD, PII
access, customer mutations, etc.

NOTE: The DB schema for `audit_logs` does NOT inherit AuditBase — it has its
own primary key, optional user_id, jsonb payloads, and a `timestamp` column
(distinct from created_at). Do not change the column set without a migration.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # NULL allowed: anonymous events (e.g. failed login by unknown user).
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # e.g. LOGIN_SUCCESS, LOGIN_FAIL, LOGIN_LOCKED, USER_CREATE, USER_DELETE,
    # ROLE_CHANGE, CUSTOMER_CREATE/UPDATE/DELETE, PERSONNEL_CREATE/UPDATE/
    # DELETE/LOOKUP, LOAN_PERSONNEL_ADD/REMOVE, PII_UNMASK.
    # Width matches target_table (50); long names like LOAN_PERSONNEL_REMOVE
    # (21) previously overflowed the old varchar(20) and were truncated.
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Logical table name the action targets (e.g. "users", "customers").
    target_table: Mapped[str] = mapped_column(String(50), nullable=False)

    # Target row id. For LOGIN_FAIL where no user matched, use uuid.UUID(int=0).
    record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    old_data: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    new_data: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
