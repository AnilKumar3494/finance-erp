"""
Timezone-aware datetime helpers.

Always use `utcnow()` instead of `datetime.utcnow()` (deprecated, naive) or
`datetime.now()` (local time). All timestamps in the system are stored as
`timestamptz` in PostgreSQL.

For calendar-date access prefer `today_in_tz(tz_name)` over `date.today()`
so the date matches the user-facing timezone, not the server's clock.
"""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo


def utcnow() -> datetime:
    """Timezone-aware current UTC time. Use everywhere instead of datetime.utcnow()."""
    return datetime.now(timezone.utc)


def today_in_tz(tz_name: str) -> date:
    """
    Today's calendar date in the given IANA timezone (e.g. 'Asia/Kolkata').

    Use this instead of `date.today()` whenever the result will be compared
    against business dates the user sees. Server clocks are typically UTC,
    so `date.today()` rolls over at 05:30 IST and gives the wrong day for
    late-evening Indian operations.
    """
    return datetime.now(ZoneInfo(tz_name)).date()
