"""
Safe translation of DB integrity errors into client-facing messages.
"""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError

# Generic fallback when we don't recognise the violated constraint.
_GENERIC_DUPLICATE_MESSAGE = "A record with these unique details already exists."

# Whitelist of constraints we're willing to name in user-facing text.
# Anything not in this dict falls back to the generic message so we never
# leak unexpected schema details (table renames, internal indexes, etc.).
_CONSTRAINT_MESSAGES: dict[str, str] = {
    # Customers — migration 003 replaced the full UNIQUE constraints with
    # PARTIAL unique indexes (`WHERE is_deleted = false`), so the constraint
    # name Postgres reports on violation is the partial-index name.
    "uq_customers_mobile_active": "A customer with this mobile number already exists.",
    "uq_customers_aadhaar_active": "A customer with this Aadhaar number already exists.",
    "uq_customers_pan_active": "A customer with this PAN already exists.",
    # Users
    "users_username_key": "This username is already taken.",
    "users_email_key": "This email address is already taken.",
    # Loans
    "loans_loan_number_key": "A loan with this number already exists.",
    # Vehicles
    "vehicles_chassis_number_key": "A vehicle with this chassis number already exists.",
    "uq_vehicles_plate_number_active": "A vehicle with this plate number already exists.",
}


def safe_integrity_message(e: IntegrityError) -> str:
    """
    Return a user-friendly message for a duplicate/constraint error.

    Reads psycopg's diagnostic info (`e.orig.diag.constraint_name`) to map
    the violated constraint to a known message. Falls back to a generic
    string for any constraint we haven't whitelisted, so we never reveal
    internal schema details by accident.
    """
    diag = getattr(getattr(e, "orig", None), "diag", None)
    cname = getattr(diag, "constraint_name", None) if diag else None
    if cname and cname in _CONSTRAINT_MESSAGES:
        return _CONSTRAINT_MESSAGES[cname]
    return _GENERIC_DUPLICATE_MESSAGE
