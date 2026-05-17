"""
Safe translation of DB integrity errors into client-facing messages.

Raw DB errors (constraint names, column names, SQL fragments) must never
reach the client — they leak schema internals. Everything funnels through
one generic message.
"""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError

# Single generic message — deliberately does not echo constraint/column names.
_DUPLICATE_MESSAGE = "A record with these unique details already exists."


def safe_integrity_message(_: IntegrityError) -> str:
    """Return a generic, non-leaking message for a duplicate/constraint error."""
    return _DUPLICATE_MESSAGE
