"""
Timezone-aware datetime helpers.

Always use `utcnow()` instead of `datetime.utcnow()` (deprecated, naive) or
`datetime.now()` (local time). All timestamps in the system are stored as
`timestamptz` in PostgreSQL.
"""
from datetime import datetime, timezone


def utcnow() -> datetime:
    """Timezone-aware current UTC time. Use everywhere instead of datetime.utcnow()."""
    return datetime.now(timezone.utc)
