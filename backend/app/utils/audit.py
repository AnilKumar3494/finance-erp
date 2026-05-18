"""
Audit log writer.

All privileged actions MUST go through `write_audit()` so we have a single
choke point for NBFC compliance. The writer:

  - Never raises (audit failures must not break the originating request).
  - Uses a SAVEPOINT (nested transaction) so a failure can be rolled back
    without poisoning the caller's transaction.
  - Caller is responsible for committing the outer transaction.

The `payload` dicts are coerced to JSON-safe form (UUIDs/dates → strings).
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app.utils.client_ip import resolve_client_ip
from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)

# Sentinel for actions where no specific record was touched (e.g. failed login
# by an unknown user, or a list-PII access action).
NO_RECORD = uuid.UUID(int=0)


def _json_safe(value: Any) -> Any:
    """Make UUIDs / datetimes / etc. JSON-serializable for JSONB columns."""
    return json.loads(json.dumps(value, default=str))


def client_ip(request: Optional[Request]) -> Optional[str]:
    """Thin wrapper kept for existing callers; logic lives in the shared
    trusted-proxy resolver so audit IPs and rate-limit keys never diverge."""
    return resolve_client_ip(request)


def write_audit(
    db: Session,
    *,
    action_type: str,
    target_table: str,
    record_id: Optional[uuid.UUID] = None,
    user_id: Optional[uuid.UUID] = None,
    old_data: Optional[dict] = None,
    new_data: Optional[dict] = None,
    request: Optional[Request] = None,
    ip_address: Optional[str] = None,
) -> None:
    """
    Append an audit row. Never raises. Caller commits.

    Use NO_RECORD (the default) when there is no specific row id, e.g.:
      - LOGIN_FAIL where the username didn't match any user.
    """
    try:
        entry = AuditLog(
            user_id=user_id,
            # No slicing: an over-length action_type must fail loudly (caught
            # below, logged, audit row dropped) rather than be silently
            # truncated into a corrupted/ambiguous compliance record. Column
            # is varchar(50); all current action types fit.
            action_type=action_type,
            target_table=target_table[:50],
            record_id=record_id or NO_RECORD,
            old_data=_json_safe(old_data) if old_data is not None else None,
            new_data=_json_safe(new_data) if new_data is not None else None,
            ip_address=ip_address or client_ip(request),
        )
        # SAVEPOINT — if audit write fails, the outer txn survives.
        with db.begin_nested():
            db.add(entry)
    except Exception as exc:  # noqa: BLE001 — never propagate audit errors
        # No exc_info / no exception message: a DB driver error can embed
        # bound parameters (potentially sensitive) in both its text and its
        # traceback frames-chain repr. The exception *type* plus the action
        # context is enough to alert and triage an audit-write failure.
        logger.error(
            "audit_write_failed error=%s action=%s target=%s record=%s",
            type(exc).__name__,
            action_type,
            target_table,
            record_id,
        )
