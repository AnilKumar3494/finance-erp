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

from app.core.config import settings
from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)

# Sentinel for actions where no specific record was touched (e.g. failed login
# by an unknown user, or a list-PII access action).
NO_RECORD = uuid.UUID(int=0)


def _json_safe(value: Any) -> Any:
    """Make UUIDs / datetimes / etc. JSON-serializable for JSONB columns."""
    return json.loads(json.dumps(value, default=str))


def client_ip(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None

    direct_ip = (
        request.client.host[:45] if request.client and request.client.host else None
    )

    if settings.TRUST_FORWARDED_FOR:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            parts = [p.strip() for p in xff.split(",") if p.strip()]
            if parts:
                idx = max(0, len(parts) - settings.TRUSTED_PROXY_HOPS)
                return parts[idx][:45]

    return direct_ip


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
            action_type=action_type[:20],
            target_table=target_table[:50],
            record_id=record_id or NO_RECORD,
            old_data=_json_safe(old_data) if old_data is not None else None,
            new_data=_json_safe(new_data) if new_data is not None else None,
            ip_address=ip_address or client_ip(request),
        )
        # SAVEPOINT — if audit write fails, the outer txn survives.
        with db.begin_nested():
            db.add(entry)
    except Exception:  # noqa: BLE001 — never propagate audit errors
        logger.exception(
            "audit_write_failed action=%s target=%s record=%s",
            action_type,
            target_table,
            record_id,
        )
