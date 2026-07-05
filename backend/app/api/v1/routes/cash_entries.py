"""
Cash entries — the capital & expenses ledger (admin-only).

Non-loan cash movements: capital in/out, expenses, other income. These feed
the Day Report's rolling position so it reads like a real cash book.
"""
import uuid
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.dependencies.auth import require_admin
from app.models.cash_entry import CashEntryType
from app.models.user import User
from app.schemas.cash_entry import (
    CashEntryCreate,
    CashEntryListResponse,
    CashEntryResponse,
    CashEntryUpdate,
)
from app.services.cash_entry import (
    create_cash_entry,
    delete_cash_entry,
    get_cash_entry,
    list_cash_entries,
    update_cash_entry,
)
from app.utils.audit import write_audit
from app.utils.time import today_in_tz

router = APIRouter(prefix="/cash-entries", tags=["Cash entries"])


@router.post(
    "/",
    response_model=CashEntryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a capital/expense entry",
)
def create_entry(
    payload: CashEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    entry = create_cash_entry(db, payload, current_user.id)
    write_audit(
        db,
        action_type="CASH_ENTRY_CREATED",
        target_table="cash_entries",
        record_id=entry.id,
        user_id=current_user.id,
        new_data={
            "entry_type": entry.entry_type.value,
            "entry_date": str(entry.entry_date),
            "amount": str(entry.amount),
            "category": entry.category,
        },
    )
    return entry


@router.get(
    "/",
    response_model=CashEntryListResponse,
    summary="List capital/expense entries in a date window",
)
def list_entries(
    date1: Optional[date] = Query(None, description="Start date (default: 30 days ago, IST)"),
    date2: Optional[date] = Query(None, description="End date (default: today, IST)"),
    entry_type: Optional[CashEntryType] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    today = today_in_tz(settings.REPORTS_TIMEZONE)
    d2 = date2 or today
    d1 = date1 or (d2 - timedelta(days=30))
    if d2 < d1:
        raise HTTPException(status_code=400, detail="date2 must be on or after date1.")
    return list_cash_entries(db, date1=d1, date2=d2, entry_type=entry_type)


@router.patch(
    "/{entry_id}",
    response_model=CashEntryResponse,
    summary="Edit a capital/expense entry",
)
def update_entry(
    entry_id: uuid.UUID,
    payload: CashEntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    entry = get_cash_entry(db, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Cash entry not found.")
    old = {
        "entry_type": entry.entry_type.value,
        "entry_date": str(entry.entry_date),
        "amount": str(entry.amount),
        "category": entry.category,
    }
    entry = update_cash_entry(db, entry, payload, current_user.id)
    write_audit(
        db,
        action_type="CASH_ENTRY_UPDATED",
        target_table="cash_entries",
        record_id=entry.id,
        user_id=current_user.id,
        old_data=old,
        new_data={
            "entry_type": entry.entry_type.value,
            "entry_date": str(entry.entry_date),
            "amount": str(entry.amount),
            "category": entry.category,
        },
    )
    return entry


@router.delete(
    "/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a capital/expense entry",
)
def delete_entry(
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    entry = get_cash_entry(db, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Cash entry not found.")
    delete_cash_entry(db, entry, current_user.id)
    write_audit(
        db,
        action_type="CASH_ENTRY_DELETED",
        target_table="cash_entries",
        record_id=entry.id,
        user_id=current_user.id,
        old_data={
            "entry_type": entry.entry_type.value,
            "entry_date": str(entry.entry_date),
            "amount": str(entry.amount),
        },
    )
