"""
Bad-debt proposal service.

Workflow:
  - EMPLOYEE or higher can PROPOSE a loan for bad debt with a reason.
  - The penalty engine auto-proposes when the penalty cap is hit
    (via `auto_propose_bad_debt` invoked from the cap-detection code path).
  - ADMIN or SUPER_ADMIN reviews:
      APPROVE → loan goes to BAD_DEBT (formal write-off via /close is still
                an admin choice; this just marks the loan terminal-eligible).
      REJECT  → proposal is rejected; loan returns to ACTIVE.

  At most one PROPOSED row per loan at a time (DB-enforced).
"""
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import Date, cast, func, literal, literal_column, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.bad_debt_proposal import BadDebtProposal, BadDebtProposalStatus
from app.models.customer import Customer
from app.models.due_cycle import CycleStatus, DueCycle
from app.models.loan import Loan, LoanStatus


class DuplicateProposalError(ValueError):
    """Raised when an open proposal already exists for the loan.

    Dedicated subclass so callers (like auto_propose_bad_debt) can recover
    from this specific race without swallowing other real precondition
    errors (e.g. trying to propose on a CLOSED loan).
    """


def get_open_proposal(db: Session, loan_id: uuid.UUID) -> Optional[BadDebtProposal]:
    return (
        db.query(BadDebtProposal)
        .filter(
            BadDebtProposal.loan_id == loan_id,
            BadDebtProposal.status == BadDebtProposalStatus.PROPOSED,
            BadDebtProposal.is_deleted.is_(False),
        )
        .first()
    )


def propose_bad_debt(
    db: Session,
    loan: Loan,
    proposed_by: Optional[uuid.UUID],
    reason: str,
    auto: bool = False,
) -> BadDebtProposal:
    """
    Create a new BAD_DEBT proposal. Caller must hold the loan lock.

    Side-effects: loan.status → BAD_DEBT_PROPOSED.
    """
    if loan.status in (LoanStatus.BAD_DEBT, LoanStatus.CLOSED):
        raise ValueError(
            f"Cannot propose bad debt — loan is {loan.status.value}"
        )

    existing = get_open_proposal(db, loan.id)
    if existing is not None:
        raise DuplicateProposalError("A bad-debt proposal is already open for this loan")

    # Scope the insert + loan-status change inside a savepoint so a race
    # with another concurrent proposer rolls back ONLY this block — not
    # any earlier work the caller has already done in the same transaction
    # (e.g. the cap path in apply_penalty has already written the penalty
    # event by the time this is invoked).
    sp = db.begin_nested()
    try:
        proposal = BadDebtProposal(
            loan_id=loan.id,
            status=BadDebtProposalStatus.PROPOSED,
            proposed_reason=reason,
            proposed_by_id=None if auto else proposed_by,
            auto_proposed=auto,
            created_by_id=proposed_by,
        )
        db.add(proposal)

        loan.status = LoanStatus.BAD_DEBT_PROPOSED
        loan.updated_by_id = proposed_by

        db.flush()
        sp.commit()
    except IntegrityError:
        sp.rollback()
        raise DuplicateProposalError(
            "A bad-debt proposal is already open for this loan"
        )
    return proposal


def review_proposal(
    db: Session,
    proposal: BadDebtProposal,
    loan: Loan,
    decision: str,  # "APPROVE" | "REJECT"
    reviewer_id: uuid.UUID,
    review_notes: Optional[str] = None,
) -> BadDebtProposal:
    """
    Admin/Super-Admin decision. Caller holds the loan lock.

    APPROVE → loan stays BAD_DEBT_PROPOSED (admin can then write-off via
              /loans/{id}/close with closure_type=WRITE_OFF to reach BAD_DEBT).
              The proposal itself transitions to APPROVED.
    REJECT  → loan reverts to ACTIVE; proposal goes to REJECTED.
    """
    if proposal.status != BadDebtProposalStatus.PROPOSED:
        raise ValueError(
            f"Proposal is already {proposal.status.value}; cannot review again"
        )
    if decision not in ("APPROVE", "REJECT"):
        raise ValueError("decision must be APPROVE or REJECT")

    now = datetime.now(timezone.utc)
    proposal.reviewed_by_id = reviewer_id
    proposal.reviewed_at = now
    proposal.review_notes = review_notes
    proposal.updated_by_id = reviewer_id

    if decision == "APPROVE":
        proposal.status = BadDebtProposalStatus.APPROVED
        # Loan stays BAD_DEBT_PROPOSED until admin executes WRITE_OFF close.
    else:
        proposal.status = BadDebtProposalStatus.REJECTED
        loan.status = LoanStatus.ACTIVE
        loan.updated_by_id = reviewer_id

    return proposal


def reopen_proposal(
    db: Session,
    proposal: BadDebtProposal,
    loan: Loan,
    reviewer_id: uuid.UUID,
) -> BadDebtProposal:
    """
    Undo an APPROVED review decision — the proposal returns to PROPOSED so it
    re-enters the review queue. The loan is left BAD_DEBT_PROPOSED (approve
    never changed it), so there's no loan-status change. Caller holds the loan
    lock.

    Guarded by the one-open-proposal-per-loan rule: refuse if another PROPOSED
    row somehow already exists for this loan (the partial unique index would
    reject the write anyway).
    """
    if proposal.status != BadDebtProposalStatus.APPROVED:
        raise ValueError(
            f"Only an APPROVED proposal can be reopened; this one is "
            f"{proposal.status.value}"
        )
    if loan.status != LoanStatus.BAD_DEBT_PROPOSED:
        raise ValueError(
            f"Cannot reopen — loan is {loan.status.value}, not BAD_DEBT_PROPOSED"
        )

    existing = get_open_proposal(db, loan.id)
    if existing is not None and existing.id != proposal.id:
        raise DuplicateProposalError(
            "Another open proposal already exists for this loan"
        )

    # Clear the prior review so the row reads as genuinely pending again.
    proposal.status = BadDebtProposalStatus.PROPOSED
    proposal.reviewed_by_id = None
    proposal.reviewed_at = None
    proposal.review_notes = None
    proposal.updated_by_id = reviewer_id
    return proposal


def withdraw_auto_proposal_on_full_payment(
    db: Session,
    loan: Loan,
    user_id: uuid.UUID,
) -> Optional[BadDebtProposal]:
    """
    A BAD_DEBT_PROPOSED loan has just been paid to zero outstanding.

    A customer who clears the whole balance is, by definition, not a bad debt,
    so the outstanding auto-proposal must not linger in the admin's review
    queue. Reject it here with an accurate note (this is a system unwind driven
    by full payment, NOT an admin review decision) and let the caller move the
    loan to AWAITING_CLOSURE.

    Only AUTO proposals are touched — a manual employee/admin proposal reflects
    a human judgment the payment doesn't automatically overturn; leave it for
    the admin to review. Caller holds the loan lock and commits.

    Note: this deliberately does NOT supersede the capped penalty_event or the
    MISSED_CAPPED cycle — those stay on the books as the historical record of
    what happened, the same way settled loans carry their old cycles. That is
    why the existing `_withdraw_auto_proposal_if_no_cap_remains` (guarded on the
    cap being gone) cannot be reused for this trigger.
    """
    prop = get_open_proposal(db, loan.id)
    if prop is None or not prop.auto_proposed:
        return None

    now = datetime.now(timezone.utc)
    prop.status = BadDebtProposalStatus.REJECTED
    prop.reviewed_by_id = user_id
    prop.reviewed_at = now
    prop.review_notes = "Auto-withdrawn: loan paid in full."
    prop.updated_by_id = user_id
    return prop


def auto_propose_bad_debt(
    db: Session,
    loan: Loan,
    reason: str,
    system_actor_id: Optional[uuid.UUID],
) -> Optional[BadDebtProposal]:
    """
    Idempotent: if a PROPOSED row already exists, return it (no-op).
    Otherwise create one with auto_proposed=True. Used by the penalty cap
    path and the nightly job. system_actor_id may be None (e.g. when the
    nightly job is the actor — no current user).
    """
    existing = get_open_proposal(db, loan.id)
    if existing is not None:
        return existing
    try:
        return propose_bad_debt(
            db,
            loan,
            proposed_by=system_actor_id,  # None is allowed (column is nullable)
            reason=reason,
            auto=True,
        )
    except DuplicateProposalError:
        # Race with another proposer — refetch and return. Other ValueErrors
        # (e.g. loan is CLOSED / BAD_DEBT) propagate so callers see them.
        return get_open_proposal(db, loan.id)


# --------------------------------------------------------------------------
# Bad-debt candidates — ACTIVE loans with a cycle overdue past the penalty
# cap, not yet proposed. This is the cross-loan version of the per-loan
# "Consider proposing this for bad-debt review" nudge on the collections
# cockpit: it surfaces loans an admin should look at BEFORE a proposal exists.
# The condition mirrors the nightly cap-detection (services/penalty.py cap
# branch + jobs/nightly_cycle_check):
#     penalty reaches its cap  <=>  days_late >= days_in_month * 100 / rate
# and, because days_late is an integer, `days_late >= x` is exactly the
# `days_late >= ceil(x)` the job uses, so this needs no separate ceiling.
# --------------------------------------------------------------------------

# Sortable columns for the candidate list. days_overdue / shortfall come off the
# worst-cycle + aggregate subqueries, resolved by the caller.
_CANDIDATE_SORTABLE = {"principal", "customer_name", "loan", "days_overdue", "shortfall"}


def list_bad_debt_candidates(
    db: Session,
    today: date,
    *,
    assigned_employee_id: Optional[uuid.UUID] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = None,
) -> tuple[int, list[dict]]:
    """Return (total_loans, page_rows) of bad-debt candidates.

    A candidate is one ACTIVE loan (penalty_rate > 0) carrying at least one
    unpaid AWAITING_REVIEW cycle whose lateness has crossed the penalty cap.
    One row per loan, keyed to its WORST (earliest-due) qualifying cycle, with
    the count of cap-crossed cycles and their summed shortfall so an admin can
    weigh the loan at a glance and Propose from the row.
    """
    # days in the due cycle's calendar month = day-of-month of that month's last
    # day (date_trunc to the 1st, add a month, step back a day, read the day).
    days_in_month = func.extract(
        "day",
        func.date_trunc("month", DueCycle.due_date)
        + literal_column("interval '1 month'")
        - literal_column("interval '1 day'"),
    )
    # date - date is an integer number of days in Postgres.
    days_late = cast(literal(today), Date) - DueCycle.due_date
    shortfall = func.greatest(DueCycle.total_due - DueCycle.total_received, 0)
    # Cap reached: days_late >= days_in_month * 100 / penalty_rate.
    cap_hit = days_late * Loan.penalty_rate >= days_in_month * 100

    qualifying = (
        db.query(
            DueCycle.loan_id.label("loan_id"),
            DueCycle.cycle_number.label("cycle_number"),
            DueCycle.due_date.label("due_date"),
            days_late.label("days_late"),
            shortfall.label("shortfall"),
        )
        .join(Loan, Loan.id == DueCycle.loan_id)
        .filter(
            DueCycle.is_deleted.is_(False),
            Loan.is_deleted.is_(False),
            Loan.status == LoanStatus.ACTIVE,
            Loan.penalty_rate > 0,
            DueCycle.cycle_status == CycleStatus.AWAITING_REVIEW,
            DueCycle.total_received < DueCycle.total_due,
            cap_hit,
        )
        .subquery()
    )

    # One row per loan = its earliest-due qualifying cycle (DISTINCT ON), which
    # is also the most overdue one.
    worst = (
        db.query(
            qualifying.c.loan_id,
            qualifying.c.cycle_number,
            qualifying.c.due_date,
            qualifying.c.days_late,
        )
        .distinct(qualifying.c.loan_id)
        .order_by(
            qualifying.c.loan_id,
            qualifying.c.due_date.asc(),
            qualifying.c.cycle_number.asc(),
        )
        .subquery()
    )

    # Per-loan rollup: how many cycles crossed the cap and their total shortfall.
    agg = (
        db.query(
            qualifying.c.loan_id.label("loan_id"),
            func.count().label("cap_cycles"),
            func.coalesce(func.sum(qualifying.c.shortfall), 0).label("total_shortfall"),
        )
        .group_by(qualifying.c.loan_id)
        .subquery()
    )

    q = (
        db.query(Loan, Customer, worst, agg)
        .join(Customer, Customer.id == Loan.customer_id)
        .join(worst, worst.c.loan_id == Loan.id)
        .join(agg, agg.c.loan_id == Loan.id)
        .filter(Customer.is_deleted.is_(False))
    )

    if assigned_employee_id is not None:
        q = q.filter(Customer.assigned_employee_id == assigned_employee_id)

    if search:
        s = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        q = q.filter(
            or_(
                Loan.loan_number.ilike(f"%{s}%", escape="\\"),
                Loan.hp_number.ilike(f"%{s}%", escape="\\"),
                Customer.full_name.ilike(f"%{s}%", escape="\\"),
                Customer.mobile_number.ilike(f"%{s}%", escape="\\"),
            )
        )

    # One row per loan now, so the row count is the loan count.
    total = q.count()

    sortable = {
        "principal": Loan.principal,
        "customer_name": Customer.full_name,
        "loan": Loan.hp_number,
        "days_overdue": worst.c.days_late,
        "shortfall": agg.c.total_shortfall,
    }
    key = sort_by if sort_by in _CANDIDATE_SORTABLE else "days_overdue"
    column = sortable[key]
    # Default most-overdue first; a stable secondary key keeps paging consistent.
    descending = (sort_order or "desc").lower() != "asc"
    ordering = column.desc() if descending else column.asc()

    rows = (
        q.order_by(ordering, Loan.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    results = [
        {
            "loan_id": loan.id,
            "loan_number": loan.loan_number,
            "hp_number": loan.hp_number,
            "principal": loan.principal,
            "customer_id": customer.id,
            "customer_name": customer.full_name,
            "customer_mobile": customer.mobile_number,
            "mandal_village": customer.mandal_village,
            "worst_cycle_number": worst_cycle_number,
            "worst_due_date": worst_due_date,
            "days_overdue": int(worst_days_late),
            "cap_cycles": int(cap_cycles),
            "shortfall": total_shortfall,
        }
        for (
            loan,
            customer,
            _worst_loan_id,
            worst_cycle_number,
            worst_due_date,
            worst_days_late,
            _agg_loan_id,
            cap_cycles,
            total_shortfall,
        ) in rows
    ]
    return total, results
