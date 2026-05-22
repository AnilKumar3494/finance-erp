"""
Due-cycle service.

Owns:
  - Generating the 1..tenure cycle rows at loan approval.
  - Read helpers for cycles.

Penalty calculation and admin classification live in `services/penalty.py`
(added in step 4/5) — kept separate so this module stays focused.
"""
import uuid
from datetime import date
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.due_cycle import CycleStatus, DueCycle
from app.models.loan import Loan
from app.services.finance import cycle_due_date, emi_schedule


def generate_cycles_for_loan(
    db: Session,
    loan: Loan,
    approved_by: uuid.UUID,
) -> List[DueCycle]:
    """
    Create one DueCycle row per month of tenure.

    Pre-conditions (asserted by caller — loan approval):
      - loan.approval_date is set (date the admin approved the loan)
      - loan.due_day_of_month is set (derived from approval_date.day)
      - No active cycles already exist for this loan

    EMI distribution:
      - First (tenure - 1) cycles use the rounded EMI.
      - Final cycle absorbs any rounding remainder so totals match exactly.

    Cycles are added to the session but NOT committed — the caller controls
    the transaction boundary so approval is atomic.
    """
    if loan.approval_date is None:
        raise ValueError("Cannot generate cycles for a loan without an approval_date")
    if loan.tenure <= 0:
        raise ValueError("Cannot generate cycles for a loan with non-positive tenure")

    existing = (
        db.query(DueCycle)
        .filter(DueCycle.loan_id == loan.id, DueCycle.is_deleted.is_(False))
        .first()
    )
    if existing is not None:
        raise ValueError(
            f"Loan {loan.id} already has due cycles; refusing to regenerate"
        )

    regular_emi, final_emi = emi_schedule(
        loan.principal, loan.interest_rate, loan.tenure
    )

    created: List[DueCycle] = []
    today = date.today()

    for cycle_number in range(1, loan.tenure + 1):
        emi_for_this_cycle = (
            final_emi if cycle_number == loan.tenure else regular_emi
        )
        due = cycle_due_date(loan.approval_date, cycle_number)

        cycle = DueCycle(
            loan_id=loan.id,
            cycle_number=cycle_number,
            due_date=due,
            base_emi=emi_for_this_cycle,
            total_due=emi_for_this_cycle,
            # All freshly-generated cycles start UPCOMING. The nightly job
            # promotes them to AWAITING_REVIEW once the due date passes
            # with a shortfall.
            cycle_status=(
                CycleStatus.AWAITING_REVIEW
                if due < today
                else CycleStatus.UPCOMING
            ),
            created_by_id=approved_by,
        )
        db.add(cycle)
        created.append(cycle)

    return created


def get_cycle(db: Session, cycle_id: uuid.UUID) -> Optional[DueCycle]:
    return (
        db.query(DueCycle)
        .filter(DueCycle.id == cycle_id, DueCycle.is_deleted.is_(False))
        .first()
    )


def list_cycles_for_loan(db: Session, loan_id: uuid.UUID) -> List[DueCycle]:
    """All non-deleted cycles for a loan, in cycle-number order."""
    return (
        db.query(DueCycle)
        .filter(DueCycle.loan_id == loan_id, DueCycle.is_deleted.is_(False))
        .order_by(DueCycle.cycle_number)
        .all()
    )


def find_target_cycle_for_payment(
    db: Session,
    loan_id: uuid.UUID,
    effective_payment_date: date,
) -> Optional[DueCycle]:
    """
    Default allocation rule:
      - The earliest cycle whose due_date >= effective_payment_date.
      - If all cycles' due_dates are in the past (loan over-tenure), return the last cycle.

    Admin can override the allocation explicitly in the API layer.
    """
    cycles = list_cycles_for_loan(db, loan_id)
    if not cycles:
        return None

    for cycle in cycles:
        if cycle.due_date >= effective_payment_date:
            return cycle

    return cycles[-1]
