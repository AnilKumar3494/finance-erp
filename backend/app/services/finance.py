"""
Shared finance calculations used by loan, transaction, and due-cycle services.

Pure functions — no DB access here. Centralised to avoid the
loan ↔ transaction circular-import smell flagged in the audit.
"""
import calendar
from datetime import date
from decimal import Decimal, ROUND_HALF_EVEN
from typing import Tuple


_TWO_PLACES = Decimal("0.01")


def _q(value: Decimal) -> Decimal:
    """Quantise to 2 decimal places using banker's rounding (matches DB NUMERIC(15,2))."""
    return value.quantize(_TWO_PLACES, rounding=ROUND_HALF_EVEN)


def monthly_interest(principal: Decimal, annual_rate: Decimal) -> Decimal:
    """Simple flat interest per month: (P * R / 100) / 12, rounded to paise."""
    return _q((principal * annual_rate / Decimal(100)) / Decimal(12))


def total_payable(principal: Decimal, annual_rate: Decimal, tenure: int) -> Decimal:
    """Principal + (monthly_interest * tenure). Monthly is rounded first per agreed rule."""
    mi = monthly_interest(principal, annual_rate)
    return _q(principal + (mi * Decimal(tenure)))


def emi_schedule(principal: Decimal, annual_rate: Decimal, tenure: int) -> Tuple[Decimal, Decimal]:
    """
    Returns (regular_emi, final_emi).
    The final month absorbs any rounding remainder so the sum equals total_payable exactly.
    """
    tp = total_payable(principal, annual_rate, tenure)
    regular = _q(tp / Decimal(tenure))
    final = _q(tp - (regular * Decimal(tenure - 1)))
    return regular, final


def cycle_due_date(approval_day: date, cycle_number: int) -> date:
    """
    Compute the due date for cycle N: the same day-of-month as `approval_day`,
    N months later. If the target month is shorter, fall back to the last day
    of that month (e.g. 31-Jan + 1 month = 28-Feb in a non-leap year).
    """
    target_month_index = approval_day.month - 1 + cycle_number
    target_year = approval_day.year + target_month_index // 12
    target_month = target_month_index % 12 + 1
    last_day = calendar.monthrange(target_year, target_month)[1]
    target_day = min(approval_day.day, last_day)
    return date(target_year, target_month, target_day)


def days_in_month_of(reference: date) -> int:
    """Calendar days in the month containing `reference`. Used for the daily penalty divisor."""
    return calendar.monthrange(reference.year, reference.month)[1]


def daily_penalty(
    late_amount: Decimal,
    annual_penalty_rate: Decimal,
    days_late: int,
    due_date: date,
) -> Decimal:
    """
    Reading B — month-length aware penalty:
        penalty = late_amount * (penalty_rate / 100) * (days_late / days_in_due_month)

    Capped at 100% of late_amount (the cap is enforced here for safety; the DB
    also has a CHECK constraint).
    """
    if days_late <= 0 or late_amount <= 0:
        return Decimal("0.00")

    raw = (
        late_amount
        * (annual_penalty_rate / Decimal(100))
        * (Decimal(days_late) / Decimal(days_in_month_of(due_date)))
    )
    penalty = _q(raw)

    # Cap at the late amount itself.
    if penalty > late_amount:
        penalty = late_amount

    return penalty
