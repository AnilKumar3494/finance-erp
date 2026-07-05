"""
Cash-entry service — the capital & expenses ledger.

Read helpers used by both the CRUD routes and the day report, so the two
surfaces never disagree on what counts as money in vs money out.
"""
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models.cash_entry import (
    CASH_IN_TYPES,
    CashEntry,
    CashEntryType,
)

_ZERO = Decimal("0.00")


def _d(value) -> Decimal:
    return _ZERO if value is None else Decimal(str(value))


def create_cash_entry(db: Session, data, user_id: uuid.UUID) -> CashEntry:
    entry = CashEntry(
        entry_type=data.entry_type,
        entry_date=data.entry_date,
        amount=data.amount,
        category=data.category,
        notes=data.notes,
        created_by_id=user_id,
        updated_by_id=user_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def get_cash_entry(db: Session, entry_id: uuid.UUID) -> Optional[CashEntry]:
    return (
        db.query(CashEntry)
        .filter(CashEntry.id == entry_id, CashEntry.is_deleted == False)
        .first()
    )


def update_cash_entry(db: Session, entry: CashEntry, data, user_id: uuid.UUID) -> CashEntry:
    for field in ("entry_type", "entry_date", "amount", "category", "notes"):
        value = getattr(data, field)
        if value is not None:
            setattr(entry, field, value)
    entry.updated_by_id = user_id
    db.commit()
    db.refresh(entry)
    return entry


def delete_cash_entry(db: Session, entry: CashEntry, user_id: uuid.UUID) -> None:
    entry.soft_delete(user_id)
    db.commit()


def list_cash_entries(
    db: Session,
    *,
    date1: date,
    date2: date,
    entry_type: Optional[CashEntryType] = None,
) -> dict:
    """
    Entries in [date1, date2] (newest first) plus per-type rollups over the
    same window. The rollups always cover ALL types in the window — even when
    a type filter narrows the rows — so the KPI cards don't jump around as
    the user flips filters.
    """
    base = db.query(CashEntry).filter(
        CashEntry.is_deleted == False,
        CashEntry.entry_date >= date1,
        CashEntry.entry_date <= date2,
    )

    def _type_sum(t: CashEntryType):
        return func.coalesce(
            func.sum(case((CashEntry.entry_type == t, CashEntry.amount), else_=0)), 0
        )

    sums = (
        base.with_entities(
            _type_sum(CashEntryType.CAPITAL_IN).label("capital_in"),
            _type_sum(CashEntryType.OTHER_INCOME).label("other_income"),
            _type_sum(CashEntryType.EXPENSE).label("expenses"),
            _type_sum(CashEntryType.CAPITAL_OUT).label("capital_out"),
        )
        .first()
    )

    rows_q = base
    if entry_type is not None:
        rows_q = rows_q.filter(CashEntry.entry_type == entry_type)
    rows = rows_q.order_by(
        CashEntry.entry_date.desc(), CashEntry.created_at.desc()
    ).all()

    capital_in = _d(sums.capital_in)
    other_income = _d(sums.other_income)
    expenses = _d(sums.expenses)
    capital_out = _d(sums.capital_out)

    return {
        "total": len(rows),
        "total_in": capital_in + other_income,
        "total_out": expenses + capital_out,
        "capital_in": capital_in,
        "other_income": other_income,
        "expenses": expenses,
        "capital_out": capital_out,
        "results": rows,
    }


def cash_entry_net_before(db: Session, day: date) -> Decimal:
    """Net (in − out) of all entries strictly before `day` — feeds the
    day report's opening position."""
    row = (
        db.query(
            func.coalesce(
                func.sum(
                    case(
                        (CashEntry.entry_type.in_(CASH_IN_TYPES), CashEntry.amount),
                        else_=-CashEntry.amount,
                    )
                ),
                0,
            )
        )
        .filter(CashEntry.is_deleted == False, CashEntry.entry_date < day)
        .scalar()
    )
    return _d(row)


def cash_entries_in_range(db: Session, date1: date, date2: date) -> list[CashEntry]:
    """All non-deleted entries in [date1, date2], oldest first — for the day
    report's per-day sections."""
    return (
        db.query(CashEntry)
        .filter(
            CashEntry.is_deleted == False,
            CashEntry.entry_date >= date1,
            CashEntry.entry_date <= date2,
        )
        .order_by(CashEntry.entry_date.asc(), CashEntry.created_at.asc())
        .all()
    )
