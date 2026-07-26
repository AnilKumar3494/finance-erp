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
from typing import List, Optional, Tuple

from sqlalchemy import and_, not_, or_
from sqlalchemy.orm import Session, aliased

from app.models.customer import Customer
from app.models.due_cycle import CycleStatus, DueCycle
from app.models.loan import Loan, LoanStatus
from app.services.finance import cycle_due_date, emi_schedule

# Loan statuses whose cycles can still be collected on — the worklist's universe.
_COLLECTIBLE_LOAN_STATUSES = (
    LoanStatus.ACTIVE,
    LoanStatus.AWAITING_CLOSURE,
    LoanStatus.BAD_DEBT_PROPOSED,
)


def generate_cycles_for_loan(
    db: Session,
    loan: Loan,
    approved_by: uuid.UUID,
    first_emi_date: Optional[date] = None,
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
        # When an explicit first-EMI date is given (e.g. backdating a loan from
        # iFinance), cycle 1 falls on it and each later cycle a month on; else
        # the default is one month after the approval date.
        due = (
            cycle_due_date(first_emi_date, cycle_number - 1)
            if first_emi_date is not None
            else cycle_due_date(loan.approval_date, cycle_number)
        )

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


def list_cycles_worklist(
    db: Session,
    *,
    status: Optional[CycleStatus] = None,
    due_before: Optional[date] = None,
    due_after: Optional[date] = None,
    unpaid_only: bool = False,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    assigned_employee_id: Optional[uuid.UUID] = None,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = None,
) -> Tuple[List[Tuple[DueCycle, Loan, Customer]], int]:
    """
    Cross-loan due-cycle worklist for the Collections module.

    Joins each cycle to its loan and customer so a collector can see who owes
    what, due when, across every loan in one list — instead of opening loans
    one by one. Restricted to collectible loan statuses (ACTIVE /
    AWAITING_CLOSURE / BAD_DEBT_PROPOSED).

    Scoping: pass `assigned_employee_id` to limit to that employee's assigned
    customers (EMPLOYEE role); leave None for ADMIN / SUPER_ADMIN (all).

    Ordered by due_date ascending (most overdue first), then loan_number, so
    the top of the list is the most pressing. Returns (rows, total) where each
    row is a (DueCycle, Loan, Customer) tuple.

    With `unpaid_only`, cycles already classified LATE_PAYMENT / MISSED_CAPPED
    whose recovery was spread forward into later cycles are excluded — they are
    being collected through the inflated future EMIs, so re-listing them would
    invite double collection. A late cycle with no later cycle to absorb the
    recovery (e.g. the final cycle) is kept, since it is genuinely outstanding.
    """
    query = (
        db.query(DueCycle, Loan, Customer)
        .join(Loan, Loan.id == DueCycle.loan_id)
        .join(Customer, Customer.id == Loan.customer_id)
        .filter(
            DueCycle.is_deleted.is_(False),
            Loan.is_deleted.is_(False),
            Customer.is_deleted.is_(False),
            Loan.status.in_(_COLLECTIBLE_LOAN_STATUSES),
        )
    )

    if assigned_employee_id is not None:
        query = query.filter(Customer.assigned_employee_id == assigned_employee_id)

    if status is not None:
        query = query.filter(DueCycle.cycle_status == status)

    if due_before is not None:
        query = query.filter(DueCycle.due_date <= due_before)

    if due_after is not None:
        query = query.filter(DueCycle.due_date >= due_after)

    if unpaid_only:
        query = query.filter(DueCycle.total_received < DueCycle.total_due)

        # A cycle classified LATE_PAYMENT / MISSED_CAPPED has its
        # (shortfall + penalty) spread forward into the LATER cycles' EMIs by
        # the penalty engine, so it is already being recovered through those
        # inflated instalments. Re-listing it here would have a collector chase
        # money the customer is paying over the remaining months — double
        # collection. Drop those rows from the collection worklist.
        #
        # Exception: a late cycle with NO later cycle on the same loan (e.g. the
        # final cycle, cases.md Case 26) had nowhere to spread the recovery to,
        # so it stays a genuine outstanding and remains on the worklist. The
        # NOT EXISTS(later cycle) guard encodes exactly that.
        later_cycle = aliased(DueCycle)
        has_later_cycle = (
            db.query(later_cycle.id)
            .filter(
                later_cycle.loan_id == DueCycle.loan_id,
                later_cycle.is_deleted.is_(False),
                later_cycle.cycle_number > DueCycle.cycle_number,
            )
            .exists()
        )
        query = query.filter(
            not_(
                and_(
                    DueCycle.cycle_status.in_(
                        (CycleStatus.LATE_PAYMENT, CycleStatus.MISSED_CAPPED)
                    ),
                    has_later_cycle,
                )
            )
        )

    if search:
        s = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(
            or_(
                Loan.loan_number.ilike(f"%{s}%", escape="\\"),
                Customer.full_name.ilike(f"%{s}%", escape="\\"),
                Customer.mobile_number.ilike(f"%{s}%", escape="\\"),
            )
        )

    total = query.count()

    # Sortable columns. days_overdue is derived in Python (not a SQL column) so
    # it isn't a sort key here; due_date order already mirrors it. Shortfall IS
    # sortable — the serialized value clamps at zero, but every worklist view is
    # unpaid-only, so on these rows total_due - total_received is always the
    # positive shortfall and the SQL expression matches what the table shows.
    # Unknown/absent sort_by keeps the default (due_date asc = most overdue
    # first). A stable secondary key (cycle id) keeps pagination consistent when
    # many rows share a sort value.
    sortable = {
        "due_date": DueCycle.due_date,
        "cycle_number": DueCycle.cycle_number,
        "cycle_status": DueCycle.cycle_status,
        "customer_name": Customer.full_name,
        "loan": Loan.hp_number,
        "shortfall": DueCycle.total_due - DueCycle.total_received,
    }
    column = sortable.get(sort_by or "due_date", DueCycle.due_date)
    descending = (sort_order or "asc").lower() == "desc"
    ordering = column.desc() if descending else column.asc()

    rows = (
        query.order_by(ordering, DueCycle.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return rows, total
