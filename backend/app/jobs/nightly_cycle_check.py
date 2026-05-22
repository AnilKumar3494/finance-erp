"""
Nightly cycle check.

Run via:  python -m app.jobs.nightly_cycle_check

For every ACTIVE / AWAITING_CLOSURE / BAD_DEBT_PROPOSED loan, for every
non-deleted cycle:

  1. Promote UPCOMING cycles whose due_date has passed and which still have
     a shortfall to AWAITING_REVIEW.

  2. For cycles in AWAITING_REVIEW or LATE_PAYMENT, compute days_late
     against today. Log a notification milestone the first time the cycle
     crosses 30 days late and 60 days late (idempotency: based on
     classification status + previously logged audit rows).

  3. When days_late × penalty_rate / days_in_due_month ≥ 100%, auto-classify
     the cycle LATE_PAYMENT with as-of date = due_date + cap_days. This
     triggers the cap branch in apply_penalty which auto-proposes bad debt.

The job is idempotent: re-running on the same day is safe.
"""
import logging
import math
import sys
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.due_cycle import CycleStatus, DueCycle
from app.models.loan import Loan, LoanStatus
from app.services.finance import days_in_month_of
from app.services.penalty import (
    apply_penalty,
    compute_shortfall,
    get_active_penalty_for_cycle,
)

logger = logging.getLogger("nightly_cycle_check")


# These milestones drive the visual / notification flow described in the spec.
DAYS_LATE_NOTIFY_30 = 30
DAYS_LATE_NOTIFY_60 = 60


def _cap_days_for(due_date: date, penalty_rate: Decimal) -> int:
    """
    Smallest number of days late at which the penalty actually REACHES
    100% of late_amount.

      penalty = late × (rate/100) × (days/days_in_month)
      cap_hit when  days/days_in_month >= 100/rate
      → days >= days_in_month * 100 / rate

    Truncation would trigger a day early (penalty 99.6% — still LATE_PAYMENT,
    not MISSED_CAPPED). Use ceiling so we only auto-classify when the cap is
    truly reached.
    """
    if penalty_rate <= 0:
        return 10**6  # effectively never
    days = Decimal(days_in_month_of(due_date)) * Decimal(100) / penalty_rate
    return math.ceil(float(days))


def _has_active_event(db: Session, cycle_id: uuid.UUID) -> bool:
    return get_active_penalty_for_cycle(db, cycle_id) is not None


def process_loan(db: Session, loan: Loan, today: date) -> dict:
    """
    Returns a per-loan dict of counters for log output.
    """
    counts = {
        "promoted_to_awaiting_review": 0,
        "notify_30_days": 0,
        "notify_60_days": 0,
        "auto_classified_at_cap": 0,
    }

    cycles = (
        db.query(DueCycle)
        .filter(
            DueCycle.loan_id == loan.id,
            DueCycle.is_deleted.is_(False),
        )
        .order_by(DueCycle.cycle_number)
        .all()
    )

    for cycle in cycles:
        if cycle.due_date >= today:
            continue  # not due yet

        shortfall = compute_shortfall(cycle)

        # (1) Promote UPCOMING -> AWAITING_REVIEW when past due with shortfall
        if cycle.cycle_status == CycleStatus.UPCOMING and shortfall > 0:
            cycle.cycle_status = CycleStatus.AWAITING_REVIEW
            counts["promoted_to_awaiting_review"] += 1
            logger.info(
                "cycle %s (loan %s, #%d) past due with shortfall %s -> AWAITING_REVIEW",
                cycle.id, loan.id, cycle.cycle_number, shortfall,
            )

        # (2) Milestone alerts — fire when days_late equals the threshold
        # exactly. The exact-day match prevents emitting on every nightly
        # run AFTER the threshold (no spam across days).
        #
        # TODO(notifications): this is NOT idempotent across same-day
        # reruns — if the cron retries after a crash on day 30, the alert
        # is emitted twice. Today the alert is just a logger.warning() so
        # duplicates are harmless. When we wire a real notification
        # provider (email/SMS/push), add a once-only marker — either:
        #   (a) a `last_notified_days_late` column on due_cycles, or
        #   (b) an audit_logs existence check on a CYCLE_MILESTONE_<N>
        #       action_type before emitting.
        # Option (b) keeps the dedup ledger out of the cycle row and
        # plays well with whichever provider gives us a delivery id.
        if cycle.cycle_status in (CycleStatus.AWAITING_REVIEW, CycleStatus.LATE_PAYMENT) and shortfall > 0:
            days_late = (today - cycle.due_date).days
            if days_late == DAYS_LATE_NOTIFY_30:
                counts["notify_30_days"] += 1
                logger.warning(
                    "ALERT loan=%s cycle=#%d days_late=%d (crossed 30) shortfall=%s",
                    loan.loan_number, cycle.cycle_number, days_late, shortfall,
                )
            elif days_late == DAYS_LATE_NOTIFY_60:
                counts["notify_60_days"] += 1
                logger.warning(
                    "ALERT loan=%s cycle=#%d days_late=%d (crossed 60) shortfall=%s "
                    "-- recommend review for bad debt",
                    loan.loan_number, cycle.cycle_number, days_late, shortfall,
                )

            # (3) Auto-classify at cap (only for cycles still in AWAITING_REVIEW;
            # cycles already classified LATE_PAYMENT are admin's call to reclassify).
            cap_days = _cap_days_for(cycle.due_date, loan.penalty_rate)
            if (
                cycle.cycle_status == CycleStatus.AWAITING_REVIEW
                and days_late >= cap_days
                and not _has_active_event(db, cycle.id)
            ):
                logger.warning(
                    "AUTO-CAP loan=%s cycle=#%d days_late=%d cap_days=%d "
                    "-- applying capped penalty + auto-proposing bad debt",
                    loan.loan_number, cycle.cycle_number, days_late, cap_days,
                )
                # apply_penalty triggers auto_propose_bad_debt internally on cap_hit
                apply_penalty(
                    db,
                    cycle=cycle,
                    loan=loan,
                    classified_as_of_date=today,
                    classified_by=None,  # system actor — column is nullable
                    classification_note=(
                        f"Auto-classified by nightly job at penalty cap "
                        f"({days_late} days late)."
                    ),
                )
                counts["auto_classified_at_cap"] += 1

    return counts


def run_once(db: Optional[Session] = None) -> dict:
    """
    Single pass over all loans. Returns aggregated counters. Commits per-loan
    so partial progress survives an exception.
    """
    own_session = db is None
    db = db or SessionLocal()
    today = date.today()

    totals = {
        "loans_scanned": 0,
        "promoted_to_awaiting_review": 0,
        "notify_30_days": 0,
        "notify_60_days": 0,
        "auto_classified_at_cap": 0,
        "errors": 0,
    }

    try:
        active_statuses = (
            LoanStatus.ACTIVE,
            LoanStatus.AWAITING_CLOSURE,
            LoanStatus.BAD_DEBT_PROPOSED,
        )
        loans = (
            db.query(Loan)
            .filter(
                Loan.status.in_(active_statuses),
                Loan.is_deleted.is_(False),
            )
            .all()
        )
        totals["loans_scanned"] = len(loans)

        for loan in loans:
            try:
                # Take a per-loan row lock to serialise against concurrent admin actions.
                locked = (
                    db.query(Loan)
                    .filter(Loan.id == loan.id)
                    .with_for_update()
                    .one()
                )
                counts = process_loan(db, locked, today)
                db.commit()
                for k, v in counts.items():
                    totals[k] = totals.get(k, 0) + v
            except Exception:
                db.rollback()
                totals["errors"] += 1
                logger.exception("nightly job failed for loan %s", loan.id)

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
    logger.info("nightly job summary: %s", summary)
    # Exit non-zero if any per-loan run failed so cron can alert.
    sys.exit(1 if summary.get("errors", 0) > 0 else 0)
