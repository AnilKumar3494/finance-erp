"""
WhatsApp EMI reminders.

Run via:  python -m app.jobs.whatsapp_reminders

For each enabled offset (default 7 and 3 days before due date), find every
UPCOMING due cycle whose due_date is exactly `today + offset` and still has an
outstanding balance, then send the customer the approved WhatsApp template
with their name, amount, due date and HP number.

Gating — a reminder is sent only when ALL hold:
  - whatsapp_settings.reminders_enabled is true (runtime master switch)
  - the loan is ACTIVE and loan.reminders_enabled is true
  - customer.whatsapp_reminders_enabled is true
  - the customer's remarks do NOT carry a "[REVIEW…]" placeholder-phone flag
  - the customer has a normalisable phone number

Idempotency: one row per (due_cycle_id, offset_days) in whatsapp_reminder_log
with status SENT/DRY_RUN (partial unique index). Re-running the same day is
safe; transient FAILED rows are retried on the next run.
"""
import logging
import sys
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import SessionLocal
from app.models.customer import Customer
from app.models.due_cycle import CycleStatus, DueCycle
from app.models.loan import Loan, LoanStatus
from app.models.whatsapp_reminder_log import ReminderStatus, WhatsAppReminderLog
from app.models.whatsapp_settings import WhatsAppSettings

# Register the rest of the mapper graph so the Customer/Loan relationships
# (User, Vehicle, Document, Transaction) resolve when this job runs as a
# standalone CLI (`python -m app.jobs.whatsapp_reminders`). Inside the running
# app these are already imported by main.py; the duplicate import is a no-op.
from app.models import user as _user  # noqa: F401
from app.models import vehicle as _vehicle  # noqa: F401
from app.models import document as _document  # noqa: F401
from app.models import transaction as _transaction  # noqa: F401
from app.services.whatsapp import get_provider, normalize_phone
from app.services.whatsapp.factory import DryRunProvider
from app.utils.audit import write_audit

logger = logging.getLogger("whatsapp_reminders")

# Loans we send reminders for. CLOSED / DRAFT / bad-debt loans are excluded.
_REMINDABLE_LOAN_STATUSES = (LoanStatus.ACTIVE, LoanStatus.AWAITING_CLOSURE)


def _format_amount(amount: Decimal) -> str:
    """₹ amount as a human string: '8,500' or '8,500.50'."""
    if amount == amount.to_integral_value():
        return f"{int(amount):,}"
    return f"{amount:,.2f}"


def _already_done(db: Session, cycle_id, offset: int) -> bool:
    """True if a SENT/DRY_RUN reminder already exists for this cycle+offset."""
    return (
        db.query(WhatsAppReminderLog.id)
        .filter(
            WhatsAppReminderLog.due_cycle_id == cycle_id,
            WhatsAppReminderLog.offset_days == offset,
            WhatsAppReminderLog.status.in_(
                (ReminderStatus.SENT.value, ReminderStatus.DRY_RUN.value)
            ),
        )
        .first()
        is not None
    )


def _eligible_cycles(db: Session, target_date: date):
    """UPCOMING, still-owed cycles due on target_date for remindable loans."""
    return (
        db.query(DueCycle, Loan, Customer)
        .join(Loan, DueCycle.loan_id == Loan.id)
        .join(Customer, Loan.customer_id == Customer.id)
        .filter(
            DueCycle.due_date == target_date,
            DueCycle.cycle_status == CycleStatus.UPCOMING,
            DueCycle.is_deleted.is_(False),
            DueCycle.total_received < DueCycle.total_due,
            Loan.is_deleted.is_(False),
            Loan.status.in_(_REMINDABLE_LOAN_STATUSES),
            Loan.reminders_enabled.is_(True),
            Customer.is_deleted.is_(False),
            Customer.whatsapp_reminders_enabled.is_(True),
            # Skip migrated/unverified placeholder phones.
            ~and_(
                Customer.remarks.isnot(None),
                Customer.remarks.ilike("%[REVIEW%"),
            ),
        )
        .order_by(DueCycle.due_date)
        .all()
    )


def _log(
    db: Session,
    *,
    cycle: DueCycle,
    loan: Loan,
    customer: Customer,
    offset: int,
    phone: Optional[str],
    status: ReminderStatus,
    message_id: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    """Insert a send-log row, committing per row. Unique-index races -> no-op."""
    db.add(
        WhatsAppReminderLog(
            due_cycle_id=cycle.id,
            loan_id=loan.id,
            customer_id=customer.id,
            offset_days=offset,
            phone=phone,
            status=status.value,
            provider_message_id=message_id,
            error=error,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # Another run already logged a SENT/DRY_RUN for this cycle+offset.
        db.rollback()


def run_once(
    db: Optional[Session] = None,
    *,
    dry_run: Optional[bool] = None,
    today: Optional[date] = None,
) -> dict:
    """
    Single pass. Returns aggregated counters.

    dry_run=True forces the dry-run provider regardless of settings (used by the
    admin "run now (dry-run)" action). today overrides the reference date (tests).
    """
    own_session = db is None
    db = db or SessionLocal()

    totals = {
        "offsets": [],
        "candidates": 0,
        "sent": 0,
        "dry_run": 0,
        "failed": 0,
        "skipped": 0,
        "already_done": 0,
        "enabled": False,
    }

    try:
        cfg = WhatsAppSettings.get(db)
        if cfg is None:
            logger.warning("whatsapp_settings row missing — run migration 017")
            return totals
        if not cfg.reminders_enabled:
            logger.info("whatsapp reminders disabled (settings.reminders_enabled=false)")
            return totals
        totals["enabled"] = True

        provider = DryRunProvider("manual-dry-run") if dry_run else get_provider()
        is_dry = getattr(provider, "is_dry_run", False)

        ref = today or datetime.now(ZoneInfo(settings.REPORTS_TIMEZONE)).date()
        offsets = [int(o) for o in (cfg.reminder_offsets_days or [])]
        totals["offsets"] = offsets

        for offset in offsets:
            target = ref + timedelta(days=offset)
            for cycle, loan, customer in _eligible_cycles(db, target):
                totals["candidates"] += 1

                if _already_done(db, cycle.id, offset):
                    totals["already_done"] += 1
                    continue

                phone = normalize_phone(
                    customer.mobile_number, settings.WHATSAPP_DEFAULT_COUNTRY_CODE
                )
                if phone is None:
                    totals["skipped"] += 1
                    _log(
                        db, cycle=cycle, loan=loan, customer=customer, offset=offset,
                        phone=None, status=ReminderStatus.SKIPPED,
                        error="no valid phone number",
                    )
                    continue

                amount = (cycle.total_due or Decimal("0")) - (
                    cycle.total_received or Decimal("0")
                )
                variables = [
                    customer.full_name,
                    _format_amount(amount),
                    cycle.due_date.strftime("%d-%b-%Y"),
                    loan.hp_number or loan.loan_number,
                ]

                result = provider.send_template(
                    to=phone,
                    template=cfg.template_name,
                    language=cfg.template_language,
                    variables=variables,
                )

                if is_dry:
                    status = ReminderStatus.DRY_RUN
                    totals["dry_run"] += 1
                elif result.ok:
                    status = ReminderStatus.SENT
                    totals["sent"] += 1
                else:
                    status = ReminderStatus.FAILED
                    totals["failed"] += 1

                _log(
                    db, cycle=cycle, loan=loan, customer=customer, offset=offset,
                    phone=phone, status=status,
                    message_id=result.message_id, error=result.error,
                )

        # Summary audit row (system actor).
        write_audit(
            db,
            action_type="WHATSAPP_REMINDERS_RUN",
            target_table="whatsapp_reminder_log",
            user_id=None,
            new_data={k: v for k, v in totals.items()},
        )
        db.commit()

    finally:
        if own_session:
            db.close()

    return totals


if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    summary = run_once()
    logger.info("whatsapp reminders summary: %s", summary)
    sys.exit(1 if summary.get("failed", 0) > 0 else 0)
