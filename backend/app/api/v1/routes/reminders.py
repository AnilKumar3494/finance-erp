"""
Admin endpoints for WhatsApp EMI reminders.

All routes are admin-only (require_admin). The settings row is the singleton
created by migration 017; per-entity toggles live on customers/loans and are
flipped here so they don't tangle with the loan-update super-admin gate.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import require_admin
from app.models.customer import Customer
from app.models.loan import Loan
from app.models.user import User
from app.models.whatsapp_reminder_log import WhatsAppReminderLog
from app.models.whatsapp_settings import WhatsAppSettings
from app.schemas.whatsapp import (
    ReminderLogResponse,
    ReminderRunResponse,
    ReminderSettingsResponse,
    ReminderSettingsUpdate,
    ReminderTestRequest,
    ReminderTestResponse,
    ReminderToggleRequest,
)
from app.services.whatsapp import get_provider, normalize_phone
from app.services.whatsapp.factory import DryRunProvider
from app.utils.audit import write_audit
from app.core.config import settings as app_settings

router = APIRouter(prefix="/reminders", tags=["WhatsApp Reminders"])


def _get_settings_or_404(db: Session) -> WhatsAppSettings:
    cfg = WhatsAppSettings.get(db)
    if cfg is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="WhatsApp settings not initialised — run migration 017.",
        )
    return cfg


# --------------------------------------------------
# SETTINGS
# --------------------------------------------------
@router.get(
    "/settings",
    response_model=ReminderSettingsResponse,
    summary="Get WhatsApp reminder settings",
)
def get_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return _get_settings_or_404(db)


@router.put(
    "/settings",
    response_model=ReminderSettingsResponse,
    summary="Update WhatsApp reminder settings",
)
def update_settings(
    request: Request,
    payload: ReminderSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cfg = _get_settings_or_404(db)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return cfg

    before = {k: getattr(cfg, k) for k in changes}
    for field, value in changes.items():
        setattr(cfg, field, value)
    cfg.updated_by_id = current_user.id

    write_audit(
        db,
        action_type="WHATSAPP_SETTINGS_UPDATE",
        target_table="whatsapp_settings",
        record_id=cfg.id,
        user_id=current_user.id,
        old_data=before,
        new_data=changes,
        request=request,
    )
    db.commit()
    db.refresh(cfg)
    return cfg


# --------------------------------------------------
# TEST SEND
# --------------------------------------------------
@router.post(
    "/test",
    response_model=ReminderTestResponse,
    summary="Send a test reminder to one number",
)
def send_test(
    request: Request,
    payload: ReminderTestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cfg = _get_settings_or_404(db)
    phone = normalize_phone(payload.to, app_settings.WHATSAPP_DEFAULT_COUNTRY_CODE)
    if phone is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid phone number.",
        )

    variables = payload.variables or [
        current_user.full_name or "Customer",
        "8,500",
        "23-Jun-2026",
        "HP-0001",
    ]

    provider = get_provider()
    result = provider.send_template(
        to=phone,
        template=cfg.template_name,
        language=cfg.template_language,
        variables=variables,
    )
    is_dry = getattr(provider, "is_dry_run", False)

    write_audit(
        db,
        action_type="WHATSAPP_TEST_SEND",
        target_table="whatsapp_settings",
        record_id=cfg.id,
        user_id=current_user.id,
        new_data={"to": phone, "dry_run": is_dry, "ok": result.ok},
        request=request,
    )
    db.commit()

    return ReminderTestResponse(
        ok=result.ok,
        dry_run=is_dry,
        to=phone,
        message_id=result.message_id,
        error=result.error,
    )


# --------------------------------------------------
# RUN NOW
# --------------------------------------------------
@router.post(
    "/run-now",
    response_model=ReminderRunResponse,
    summary="Run the reminder pass on demand",
)
def run_now(
    dry_run: bool = Query(
        False, description="Force dry-run (render + log, never send)."
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    # Imported lazily so importing the router never pulls the job tree.
    from app.jobs.whatsapp_reminders import run_once

    totals = run_once(db=db, dry_run=dry_run)
    return ReminderRunResponse(
        enabled=totals.get("enabled", False),
        offsets=totals.get("offsets", []),
        candidates=totals.get("candidates", 0),
        sent=totals.get("sent", 0),
        dry_run=totals.get("dry_run", 0),
        failed=totals.get("failed", 0),
        skipped=totals.get("skipped", 0),
        already_done=totals.get("already_done", 0),
    )


# --------------------------------------------------
# LOG
# --------------------------------------------------
@router.get(
    "/log",
    response_model=ReminderLogResponse,
    summary="List reminder send history",
)
def list_log(
    status_filter: Optional[str] = Query(
        None, alias="status", description="SENT | FAILED | SKIPPED | DRY_RUN"
    ),
    customer_id: Optional[uuid.UUID] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    query = db.query(WhatsAppReminderLog)
    if status_filter:
        query = query.filter(WhatsAppReminderLog.status == status_filter)
    if customer_id:
        query = query.filter(WhatsAppReminderLog.customer_id == customer_id)

    total = query.count()
    results = (
        query.order_by(WhatsAppReminderLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ReminderLogResponse(
        total=total, page=page, page_size=page_size, results=results
    )


# --------------------------------------------------
# PER-ENTITY TOGGLES
# --------------------------------------------------
@router.patch(
    "/customers/{customer_id}",
    summary="Enable/disable reminders for one customer",
)
def toggle_customer(
    request: Request,
    customer_id: uuid.UUID,
    payload: ReminderToggleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    customer = (
        db.query(Customer)
        .filter(Customer.id == customer_id, Customer.is_deleted.is_(False))
        .first()
    )
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )
    customer.whatsapp_reminders_enabled = payload.enabled
    customer.updated_by_id = current_user.id
    write_audit(
        db,
        action_type="WHATSAPP_CUSTOMER_TOGGLE",
        target_table="customers",
        record_id=customer.id,
        user_id=current_user.id,
        new_data={"whatsapp_reminders_enabled": payload.enabled},
        request=request,
    )
    db.commit()
    return {"id": str(customer.id), "whatsapp_reminders_enabled": payload.enabled}


@router.patch(
    "/loans/{loan_id}",
    summary="Enable/disable reminders for one finance/loan",
)
def toggle_loan(
    request: Request,
    loan_id: uuid.UUID,
    payload: ReminderToggleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    loan = (
        db.query(Loan)
        .filter(Loan.id == loan_id, Loan.is_deleted.is_(False))
        .first()
    )
    if loan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )
    loan.reminders_enabled = payload.enabled
    loan.updated_by_id = current_user.id
    write_audit(
        db,
        action_type="WHATSAPP_LOAN_TOGGLE",
        target_table="loans",
        record_id=loan.id,
        user_id=current_user.id,
        new_data={"reminders_enabled": payload.enabled},
        request=request,
    )
    db.commit()
    return {"id": str(loan.id), "reminders_enabled": payload.enabled}
