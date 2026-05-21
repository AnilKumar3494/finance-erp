"""
Penalty engine — applies the Reading-B daily penalty when an admin classifies
a due-cycle as LATE_PAYMENT.

Math (kept in services/finance.py):
    penalty = late_amount × (penalty_rate / 100) × (days_late / days_in_due_month)
    capped at 100 % of late_amount.

Spread:
    spread_per_month = (shortfall + penalty) / remaining_months
    Each remaining cycle's `addon_from_penalties` is incremented by that
    amount, and `total_due` is recomputed (base_emi + addon).

Audit:
    Every calculation writes a `penalty_events` row. Reclassifications never
    edit the old row — they create a NEW one and set the old row's
    `superseded_by_id` (handled in step 6).
"""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_EVEN
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.due_cycle import CycleStatus, DueCycle
from app.models.loan import Loan
from app.models.penalty_event import PenaltyEvent
from app.services.finance import daily_penalty, days_in_month_of


_TWO_PLACES = Decimal("0.01")


def _q(value: Decimal) -> Decimal:
    return value.quantize(_TWO_PLACES, rounding=ROUND_HALF_EVEN)


def compute_shortfall(cycle: DueCycle) -> Decimal:
    """The amount NOT received against this cycle by the as-of moment."""
    shortfall = cycle.total_due - cycle.total_received
    return shortfall if shortfall > 0 else Decimal("0.00")


def apply_penalty(
    db: Session,
    cycle: DueCycle,
    loan: Loan,
    classified_as_of_date: date,
    classified_by: Optional[uuid.UUID],
    classification_note: Optional[str] = None,
) -> PenaltyEvent:
    """
    Apply the late-payment penalty for `cycle`.

    Pre-conditions (validated here so this function is safe to call directly):
      - cycle.loan_id == loan.id
      - classified_as_of_date > cycle.due_date (otherwise no days_late)
      - cycle has a positive shortfall

    Effects (atomic within the caller's transaction — caller commits):
      - Writes a PenaltyEvent row.
      - Sets cycle.penalty_amount, cycle.cycle_status, classified_* fields.
      - Distributes (shortfall + penalty) across remaining cycles' addons.
      - Recomputes each future cycle's total_due.
    """
    if cycle.loan_id != loan.id:
        raise ValueError("cycle does not belong to this loan")

    if classified_as_of_date <= cycle.due_date:
        raise ValueError(
            "classified_as_of_date must be after the cycle's due date for LATE_PAYMENT"
        )

    shortfall = compute_shortfall(cycle)
    if shortfall <= 0:
        raise ValueError(
            "Cycle has no shortfall — use PAID_ON_TIME, not LATE_PAYMENT"
        )

    days_late = (classified_as_of_date - cycle.due_date).days
    if days_late <= 0:
        raise ValueError("days_late must be > 0")

    # Reading B math + cap.
    penalty = daily_penalty(
        late_amount=shortfall,
        penalty_rate=loan.penalty_rate,
        days_late=days_late,
        due_date=cycle.due_date,
    )
    cap_hit = penalty >= shortfall and shortfall > 0  # capped at 100 %

    amount_to_recover = _q(shortfall + penalty)

    # Find remaining ACTIVE cycles to spread into.
    remaining = (
        db.query(DueCycle)
        .filter(
            DueCycle.loan_id == loan.id,
            DueCycle.is_deleted.is_(False),
            DueCycle.cycle_number > cycle.cycle_number,
        )
        .order_by(DueCycle.cycle_number)
        .all()
    )
    remaining_count = len(remaining)

    if remaining_count > 0:
        spread = _q(amount_to_recover / Decimal(remaining_count))
        # Apply to each remaining cycle. The very last cycle absorbs any
        # rounding remainder so the totals match to the paisa.
        running_applied = Decimal("0.00")
        for idx, fut in enumerate(remaining):
            if idx == remaining_count - 1:
                this_addon = _q(amount_to_recover - running_applied)
            else:
                this_addon = spread
                running_applied = _q(running_applied + spread)
            fut.addon_from_penalties = _q(fut.addon_from_penalties + this_addon)
            fut.total_due = _q(fut.base_emi + fut.addon_from_penalties)
    else:
        # Last-cycle shortfall: no future cycles to spread into. The penalty
        # is still recorded but the recovery stays on this cycle as outstanding.
        spread = Decimal("0.00")

    # Update THIS cycle.
    cycle.penalty_amount = _q(cycle.penalty_amount + penalty)
    cycle.classified_as_of_date = classified_as_of_date
    cycle.classified_by_id = classified_by
    cycle.classified_at = datetime.now(timezone.utc)
    cycle.classification_note = classification_note
    cycle.cycle_status = (
        CycleStatus.MISSED_CAPPED if cap_hit else CycleStatus.LATE_PAYMENT
    )

    # Write the immutable audit row.
    event = PenaltyEvent(
        due_cycle_id=cycle.id,
        loan_id=loan.id,
        late_amount=shortfall,
        days_late=days_late,
        days_in_due_month=days_in_month_of(cycle.due_date),
        penalty_rate_snapshot=loan.penalty_rate,
        penalty_amount=penalty,
        cap_hit=cap_hit,
        spread_per_month=spread,
        remaining_months_at_calc=remaining_count,
        applied_by_id=classified_by,
        classification_note=classification_note,
    )
    db.add(event)
    db.flush()

    # Auto-propose bad debt when the penalty cap is hit (100% of late_amount).
    # Local import keeps the penalty <-> bad_debt module load order safe.
    if cap_hit:
        from app.services.bad_debt import auto_propose_bad_debt

        auto_propose_bad_debt(
            db,
            loan=loan,
            reason=(
                f"Penalty cap reached on cycle #{cycle.cycle_number} "
                f"(due {cycle.due_date}, {days_late} days late). "
                "Auto-proposed for admin review."
            ),
            system_actor_id=classified_by,
        )

    return event


def mark_cycle_paid_on_time(
    db: Session,
    cycle: DueCycle,
    classified_by: uuid.UUID,
    classification_note: Optional[str] = None,
) -> None:
    """
    Admin marks the cycle PAID_ON_TIME. Only allowed when shortfall = 0.

    No penalty, no spread, no audit row (penalty_events is for late events only).
    The classifier identity goes onto the cycle itself.
    """
    shortfall = compute_shortfall(cycle)
    if shortfall > 0:
        raise ValueError(
            "Cannot mark PAID_ON_TIME — cycle has a shortfall of "
            f"{shortfall}. Mark as LATE_PAYMENT or settle the shortfall first."
        )

    cycle.cycle_status = CycleStatus.PAID_ON_TIME
    cycle.classified_as_of_date = cycle.due_date  # nominal — no late-as-of
    cycle.classified_by_id = classified_by
    cycle.classified_at = datetime.now(timezone.utc)
    cycle.classification_note = classification_note


def get_active_penalty_for_cycle(
    db: Session, cycle_id: uuid.UUID
) -> Optional[PenaltyEvent]:
    """Returns the currently-active (non-superseded) penalty event for a cycle, if any."""
    return (
        db.query(PenaltyEvent)
        .filter(
            PenaltyEvent.due_cycle_id == cycle_id,
            PenaltyEvent.superseded_by_id.is_(None),
        )
        .first()
    )


def sum_active_penalties_for_loan(db: Session, loan_id: uuid.UUID) -> Decimal:
    """Total penalty currently active on a loan (sum of non-superseded events)."""
    from sqlalchemy import func

    total = (
        db.query(func.coalesce(func.sum(PenaltyEvent.penalty_amount), 0))
        .filter(
            PenaltyEvent.loan_id == loan_id,
            PenaltyEvent.superseded_by_id.is_(None),
        )
        .scalar()
    )
    return Decimal(str(total))


# --------------------------------------------------
# RECOMPUTE — replay all active events to derive cycle.addon + total_due
# --------------------------------------------------
def recompute_addons_for_loan(db: Session, loan_id: uuid.UUID) -> None:
    """
    Authoritatively re-derive every cycle's `addon_from_penalties`,
    `total_due`, and `penalty_amount` for a loan by replaying every active
    (non-superseded) penalty_event in creation order.

    Used by reclassification: rather than try to subtract a single event's
    contribution (rounding traps), we wipe and replay — bulletproof.
    """
    cycles = (
        db.query(DueCycle)
        .filter(DueCycle.loan_id == loan_id, DueCycle.is_deleted.is_(False))
        .order_by(DueCycle.cycle_number)
        .all()
    )
    if not cycles:
        return

    # Reset
    for c in cycles:
        c.addon_from_penalties = Decimal("0.00")
        c.total_due = c.base_emi
        c.penalty_amount = Decimal("0.00")

    db.flush()

    # Replay every active event in chronological order
    events = (
        db.query(PenaltyEvent)
        .filter(
            PenaltyEvent.loan_id == loan_id,
            PenaltyEvent.superseded_by_id.is_(None),
        )
        .order_by(PenaltyEvent.created_at)
        .all()
    )

    cycles_by_id = {c.id: c for c in cycles}

    for ev in events:
        source = cycles_by_id.get(ev.due_cycle_id)
        if source is None:
            continue  # cycle deleted — defensive

        # Re-stamp the source cycle's penalty_amount.
        source.penalty_amount = _q(source.penalty_amount + ev.penalty_amount)

        future = [c for c in cycles if c.cycle_number > source.cycle_number]
        if not future:
            continue

        amount_to_recover = _q(ev.late_amount + ev.penalty_amount)
        spread = _q(amount_to_recover / Decimal(len(future)))

        running = Decimal("0.00")
        for idx, fut in enumerate(future):
            if idx == len(future) - 1:
                this_addon = _q(amount_to_recover - running)
            else:
                this_addon = spread
                running = _q(running + spread)
            fut.addon_from_penalties = _q(fut.addon_from_penalties + this_addon)
            fut.total_due = _q(fut.base_emi + fut.addon_from_penalties)

    db.flush()


# --------------------------------------------------
# RECLASSIFY — supersede the current active event and re-apply
# --------------------------------------------------
def reclassify_cycle(
    db: Session,
    cycle: DueCycle,
    loan: Loan,
    new_status: CycleStatus,
    classified_as_of_date: Optional[date],
    classified_by: uuid.UUID,
    classification_note: Optional[str] = None,
) -> Tuple[DueCycle, Optional[PenaltyEvent]]:
    """
    Change an already-classified cycle's verdict. Maintains the audit chain:
      - Old active event is marked superseded (pointing to the new event if any,
        otherwise self-referencing as a "no-replacement" sentinel).
      - All cycle addons are recomputed from scratch via `recompute_addons_for_loan`.
      - A NEW penalty_event row is written when the new status is LATE_PAYMENT.
      - Allocated transactions' punctuality is re-propagated by the caller.

    Pre:
      - cycle.cycle_status is one of PAID_ON_TIME / LATE_PAYMENT / MISSED_CAPPED.
      - For PAID_ON_TIME, post-recompute the cycle must have zero shortfall.
    """
    if cycle.loan_id != loan.id:
        raise ValueError("cycle does not belong to this loan")

    if cycle.cycle_status not in (
        CycleStatus.PAID_ON_TIME,
        CycleStatus.LATE_PAYMENT,
        CycleStatus.MISSED_CAPPED,
    ):
        raise ValueError(
            f"Cycle is {cycle.cycle_status.value}; use the classify endpoint, "
            "not reclassify, for first-time classification"
        )

    if new_status not in (CycleStatus.PAID_ON_TIME, CycleStatus.LATE_PAYMENT):
        raise ValueError(
            "new_status must be PAID_ON_TIME or LATE_PAYMENT"
        )

    if new_status == CycleStatus.LATE_PAYMENT and classified_as_of_date is None:
        raise ValueError(
            "classified_as_of_date is required when new_status is LATE_PAYMENT"
        )

    # 1. Mark the current active event as superseded (sentinel = self for now;
    #    if a new event is written, we'll repoint it to the new event below).
    current_event = get_active_penalty_for_cycle(db, cycle.id)
    if current_event is not None:
        current_event.superseded_by_id = current_event.id  # placeholder sentinel
        db.flush()

    # 2. Recompute addons across the loan WITHOUT the superseded event.
    recompute_addons_for_loan(db, loan.id)

    db.refresh(cycle)

    new_event: Optional[PenaltyEvent] = None

    if new_status == CycleStatus.PAID_ON_TIME:
        if compute_shortfall(cycle) > 0:
            # Roll back the supersession so the data is consistent for the caller's rollback.
            if current_event is not None:
                current_event.superseded_by_id = None
            recompute_addons_for_loan(db, loan.id)
            raise ValueError(
                "Cannot reclassify as PAID_ON_TIME — shortfall remains "
                f"(shortfall={compute_shortfall(cycle)})"
            )

        cycle.cycle_status = CycleStatus.PAID_ON_TIME
        cycle.classified_as_of_date = cycle.due_date
        cycle.classified_by_id = classified_by
        cycle.classified_at = datetime.now(timezone.utc)
        cycle.classification_note = classification_note
        # current_event keeps its sentinel (superseded_by_id == its own id)

    else:  # LATE_PAYMENT
        # Move cycle to AWAITING_REVIEW so apply_penalty's pre-check passes.
        cycle.cycle_status = CycleStatus.AWAITING_REVIEW
        db.flush()

        new_event = apply_penalty(
            db,
            cycle=cycle,
            loan=loan,
            classified_as_of_date=classified_as_of_date,
            classified_by=classified_by,
            classification_note=classification_note,
        )
        # Re-point the old supersession to the new event.
        if current_event is not None:
            current_event.superseded_by_id = new_event.id
        db.flush()

    return cycle, new_event


def write_reclassify_audit(
    db: Session,
    cycle: DueCycle,
    actor_id: uuid.UUID,
    old_status: str,
    old_penalty: Decimal,
    new_status: str,
    new_penalty: Decimal,
    classified_as_of_date: Optional[date],
    note: Optional[str],
) -> AuditLog:
    """Append-only audit row for a cycle reclassification."""
    entry = AuditLog(
        user_id=actor_id,
        action_type="CYCLE_RECLASSIFY",
        target_table="due_cycles",
        record_id=cycle.id,
        old_data={
            "cycle_status": old_status,
            "penalty_amount": str(old_penalty),
        },
        new_data={
            "cycle_status": new_status,
            "penalty_amount": str(new_penalty),
            "classified_as_of_date": (
                classified_as_of_date.isoformat()
                if classified_as_of_date
                else None
            ),
            "note": note,
        },
    )
    db.add(entry)
    return entry
