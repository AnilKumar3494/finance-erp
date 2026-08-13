import uuid
from decimal import Decimal
from typing import Any, Optional
from datetime import date, datetime, time, timedelta, timezone

from fastapi import Request
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.schemas.loan import LoanCreate, LoanUpdate
from app.models.loan import Loan, LoanStatus
from app.models.customer import Customer
from app.models.vehicle import AssetStatus, AssetType, Vehicle
from app.models.transaction import (
    PunctualityStatus,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.models.due_cycle import DueCycle
from app.services.due_cycle import generate_cycles_for_loan, reanchor_cycles
from app.services.finance import monthly_interest, total_payable as calc_total_payable
from app.utils.audit import write_audit
from app.utils.db_errors import safe_integrity_message


def _loan_audit_snapshot(loan: Loan) -> dict:
    """Stringify Decimals so JSONB stays portable across precisions."""
    return {
        "loan_number": loan.loan_number,
        "hp_number": loan.hp_number,
        "customer_id": str(loan.customer_id),
        "vehicle_id": str(loan.vehicle_id) if loan.vehicle_id else None,
        "principal": str(loan.principal),
        "interest_rate": str(loan.interest_rate),
        "tenure": loan.tenure,
        "down_payment": str(loan.down_payment),
        "processing_fee": str(loan.processing_fee),
        "documentation_fee": str(loan.documentation_fee),
        "dsc_fee": str(loan.dsc_fee),
        "rto_fee": str(loan.rto_fee),
        "penalty_rate": str(loan.penalty_rate) if loan.penalty_rate is not None else None,
        "status": loan.status.value,
        "approval_date": loan.approval_date.isoformat() if loan.approval_date else None,
        "first_emi_date": loan.first_emi_date.isoformat() if loan.first_emi_date else None,
    }


# --------------------------------------------------
# VALID INCLUDE OPTIONS
# --------------------------------------------------
VALID_INCLUDES = {"customer", "vehicle", "created_by", "updated_by"}


# --------------------------------------------------
# COLLATERAL ELIGIBILITY
# --------------------------------------------------
# A vehicle can be attached to a loan only when it is:
#   - not soft-deleted
#   - typed as COLLATERAL (INVENTORY assets are company stock, not pledged)
#   - in a status where pledging makes sense (IN_YARD, MAINTENANCE, or
#     WITH_CUSTOMER — collateral physically held by the hirer).
# SOLD / SEIZED vehicles must never back a loan.
_PLEDGEABLE_STATUSES = (
    AssetStatus.IN_YARD,
    AssetStatus.MAINTENANCE,
    AssetStatus.WITH_CUSTOMER,
)


def is_blocking_vehicle(db: Session, vehicle_id: uuid.UUID) -> bool:
    """
    True if `vehicle_id` is the collateral on a non-deleted ACTIVE loan.
    Used by the vehicle service to decide whether a soft-delete is allowed —
    keeps the loan query inside the loan domain boundary.
    """
    return (
        db.query(Loan.id)
        .filter(
            Loan.vehicle_id == vehicle_id,
            Loan.status == LoanStatus.ACTIVE,
            Loan.is_deleted == False,
        )
        .first()
        is not None
    )


def _resolve_pledgeable_vehicle(db: Session, vehicle_id: uuid.UUID) -> Vehicle:
    vehicle = (
        db.query(Vehicle)
        .filter(Vehicle.id == vehicle_id, Vehicle.is_deleted == False)
        .first()
    )
    if not vehicle:
        raise ValueError("Vehicle not found")
    if vehicle.type != AssetType.COLLATERAL:
        raise ValueError(
            "Vehicle is not marked as COLLATERAL and cannot back a loan"
        )
    if vehicle.status not in _PLEDGEABLE_STATUSES:
        raise ValueError(
            f"Vehicle status {vehicle.status.value} is not eligible for pledging"
        )
    return vehicle


def parse_includes(include: Optional[str]) -> set[str]:
    """Parse and validate comma-separated include string"""
    if not include:
        return set()
    requested = {s.strip().lower() for s in include.split(",")}
    return requested & VALID_INCLUDES


def _apply_eager_loading(query, includes: set[str]):
    """Apply joinedload for requested relationships"""
    if "customer" in includes:
        query = query.options(joinedload(Loan.customer))
    if "vehicle" in includes:
        query = query.options(joinedload(Loan.vehicle))
    if "created_by" in includes:
        query = query.options(joinedload(Loan.created_by))
    if "updated_by" in includes:
        query = query.options(joinedload(Loan.updated_by))
    return query


# --------------------------------------------------
# CALCULATIONS
# Thin wrappers around the canonical finance helpers so existing callers
# (routes, transaction service) keep working without import churn.
# --------------------------------------------------
def calculate_monthly_interest(principal: Decimal, rate: Decimal) -> Decimal:
    """Simple flat interest per month (banker's rounding to paise)."""
    return monthly_interest(principal, rate)


def calculate_total_payable(principal: Decimal, rate: Decimal, tenure: int) -> Decimal:
    """Principal + (monthly_interest * tenure) — both quantised to paise."""
    return calc_total_payable(principal, rate, tenure)


# --------------------------------------------------
# QUERIES
# --------------------------------------------------
def get_loan(
    db: Session, loan_id: uuid.UUID, include: Optional[str] = None
) -> Optional[Loan]:
    """Fetch single active loan by ID"""
    includes = parse_includes(include)
    query = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False)
    query = _apply_eager_loading(query, includes)
    return query.first()


def generate_loan_number() -> str:
    year = datetime.now(timezone.utc).year
    random_part = str(uuid.uuid4().int)[0:6]
    return f"LMS-{year}-{random_part}"


def get_active_loans_by_customer(
    db: Session, customer_id: uuid.UUID, include: Optional[str] = None
) -> list[Loan]:
    """Get all active loans for a customer"""
    includes = parse_includes(include)
    query = db.query(Loan).filter(
        Loan.customer_id == customer_id,
        Loan.status == LoanStatus.ACTIVE,
        Loan.is_deleted == False,
    )
    query = _apply_eager_loading(query, includes)
    return query.all()


# Whitelist of sortable columns. Customer-column sorts (full_name,
# mandal_village) require a join to Customer. "created_at" backs the SNO
# column. Must match the frontend LOAN_SORT_FIELDS in api/queries/loans.ts.
_SORTABLE_COLUMNS: dict[str, Any] = {
    "created_at": Loan.created_at,
    "approval_date": Loan.approval_date,
    "full_name": Customer.full_name,
    "mandal_village": Customer.mandal_village,
    "status": Loan.status,
}

_CUSTOMER_SORT_KEYS = {"full_name", "mandal_village"}


def list_loans(
    db: Session,
    customer_id: Optional[uuid.UUID] = None,
    vehicle_id: Optional[uuid.UUID] = None,
    status: Optional[LoanStatus] = None,
    page: int = 1,
    page_size: int = 20,
    assigned_employee_id: Optional[uuid.UUID] = None,
    include: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = None,
    search: Optional[str] = None,
    created_after: Optional[date] = None,
    created_before: Optional[date] = None,
    pending_approval: Optional[bool] = None,
) -> tuple[list[Loan], int]:
    """List loans with optional filters, search, sorting, and eager loading.

    `created_after`/`created_before` bound the record's creation date
    (created_at) inclusively — a window over when the finances were written,
    including drafts (which have no approval_date). created_at is a timestamp,
    so the upper bound covers the whole of that day."""
    includes = parse_includes(include)
    query = db.query(Loan).filter(Loan.is_deleted == False)

    # Join Customer once if the employee scope, a customer-column sort, or a
    # search (which spans customer fields) needs it (avoids a double join).
    needs_customer_join = (
        assigned_employee_id is not None
        or (sort_by in _CUSTOMER_SORT_KEYS)
        or bool(search)
    )
    if needs_customer_join:
        query = query.join(Customer, Loan.customer_id == Customer.id).filter(
            Customer.is_deleted == False,
        )

    if assigned_employee_id:
        query = query.filter(Customer.assigned_employee_id == assigned_employee_id)

    # Free-text search across HP number, loan number and customer name / mobile / mandal.
    if search:
        s = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(
            or_(
                Loan.hp_number.ilike(f"%{s}%", escape="\\"),
                Loan.loan_number.ilike(f"%{s}%", escape="\\"),
                Customer.full_name.ilike(f"%{s}%", escape="\\"),
                Customer.mobile_number.ilike(f"%{s}%", escape="\\"),
                Customer.mandal_village.ilike(f"%{s}%", escape="\\"),
            )
        )

    if customer_id:
        query = query.filter(Loan.customer_id == customer_id)

    if vehicle_id:
        query = query.filter(Loan.vehicle_id == vehicle_id)

    if status:
        query = query.filter(Loan.status == status)

    # "Awaiting approval" filter: DRAFT loans whose loan-level required terms
    # are all filled in — i.e. the ones an admin can actually action now, as
    # opposed to half-built drafts still being captured. Customer/vehicle
    # completeness is re-checked at the approve step itself; this single-table
    # predicate is the cheap, index-friendly signal that a draft is prepared.
    if pending_approval:
        query = query.filter(
            Loan.status == LoanStatus.DRAFT,
            Loan.principal.isnot(None),
            Loan.interest_rate.isnot(None),
            Loan.tenure.isnot(None),
            Loan.first_emi_date.isnot(None),
        )

    if created_after is not None:
        query = query.filter(Loan.created_at >= datetime.combine(created_after, time.min))

    if created_before is not None:
        query = query.filter(
            Loan.created_at < datetime.combine(created_before + timedelta(days=1), time.min)
        )

    total = query.count()

    query = _apply_eager_loading(query, includes)

    # Sort. Unknown sort_by falls back to created_at desc so the response is
    # deterministic. The Loan.id tie-breaker keeps pagination stable when many
    # rows share a sort key (common for status / mandal_village).
    column = _SORTABLE_COLUMNS.get(sort_by or "", Loan.created_at)
    descending = (sort_order or "desc").lower() != "asc"
    ordering = column.desc() if descending else column.asc()

    results = (
        query.order_by(ordering, Loan.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return results, total


# Values for LoanResponse.emi_due_status — kept in sync with the schema Literal.
EMI_DUE_NONE = "NONE"
EMI_DUE_DUE = "DUE"
EMI_DUE_OVERDUE = "OVERDUE"
EMI_DUE_AWAITING_CONFIRMATION = "AWAITING_CONFIRMATION"


def emi_due_status_map(db: Session, loans: list[Loan]) -> dict[uuid.UUID, str]:
    """
    Per-loan EMI collection signal for the list/detail status badge. One of:
      AWAITING_CONFIRMATION — a payment is recorded but not yet confirmed by an admin
      OVERDUE               — the earliest unpaid cycle's due date has passed
      DUE                   — the earliest unpaid cycle is due today
      NONE                  — nothing due right now (or the loan isn't running)

    Computed in a single batch for the whole page (no N+1). Only ACTIVE /
    AWAITING_CLOSURE loans can have a due EMI; everything else stays NONE.
    AWAITING_CONFIRMATION takes precedence because the next action then sits
    with an admin, not the collector.
    """
    result: dict[uuid.UUID, str] = {loan.id: EMI_DUE_NONE for loan in loans}
    running_ids = [
        loan.id
        for loan in loans
        if loan.status in (LoanStatus.ACTIVE, LoanStatus.AWAITING_CLOSURE)
    ]
    if not running_ids:
        return result

    today = date.today()

    # Earliest still-unpaid (received < due) cycle per loan.
    unpaid_cycles = (
        db.query(DueCycle)
        .filter(
            DueCycle.loan_id.in_(running_ids),
            DueCycle.is_deleted == False,
            DueCycle.total_received < DueCycle.total_due,
        )
        .order_by(DueCycle.loan_id, DueCycle.due_date.asc())
        .all()
    )
    earliest: dict[uuid.UUID, DueCycle] = {}
    for cycle in unpaid_cycles:
        earliest.setdefault(cycle.loan_id, cycle)

    # Loans with at least one payment awaiting admin confirmation.
    pending_ids = {
        row[0]
        for row in db.query(Transaction.loan_id)
        .filter(
            Transaction.loan_id.in_(running_ids),
            Transaction.status == TransactionStatus.PENDING,
            Transaction.is_deleted == False,
        )
        .distinct()
        .all()
    }

    for loan_id in running_ids:
        if loan_id in pending_ids:
            result[loan_id] = EMI_DUE_AWAITING_CONFIRMATION
            continue
        cycle = earliest.get(loan_id)
        if cycle is None:
            continue  # all cycles settled → NONE
        if cycle.due_date < today:
            result[loan_id] = EMI_DUE_OVERDUE
        elif cycle.due_date == today:
            result[loan_id] = EMI_DUE_DUE
        # a future due date leaves it NONE

    return result


def create_loan(db: Session, data: LoanCreate, created_by: uuid.UUID) -> Loan:
    """
    Create a new loan in DRAFT state.

    DRAFT loans:
      - Have no due cycles yet (generated at approval).
      - Have no down-payment transaction yet (created at approval).
      - Carry no approval_date / due_day_of_month yet.

    The dedicated `approve_loan` step transitions DRAFT → ACTIVE and
    produces the schedule + DP transaction atomically.
    """
    # --------------------------------------------------
    # CHECK CUSTOMER EXISTS
    # --------------------------------------------------
    customer = (
        db.query(Customer)
        .filter(Customer.id == data.customer_id, Customer.is_deleted == False)
        .first()
    )
    if not customer:
        raise ValueError("Customer not found")

    # --------------------------------------------------
    # CHECK VEHICLE EXISTS + IS USABLE AS COLLATERAL (ONLY IF PROVIDED)
    # --------------------------------------------------
    if data.vehicle_id:
        _resolve_pledgeable_vehicle(db, data.vehicle_id)

    # --------------------------------------------------
    # GUARD: down payment cannot meet or exceed principal
    # (review item — produces negative net values otherwise)
    # --------------------------------------------------
    if (
        data.down_payment is not None
        and data.principal is not None
        and data.down_payment >= data.principal
    ):
        raise ValueError(
            "Down payment must be strictly less than principal"
        )

    loan = Loan(
        loan_number=generate_loan_number(),
        hp_number=data.hp_number,
        customer_id=data.customer_id,
        vehicle_id=data.vehicle_id,
        principal=data.principal,
        interest_rate=data.interest_rate,
        tenure=data.tenure,
        down_payment=data.down_payment,
        processing_fee=data.processing_fee,
        documentation_fee=data.documentation_fee,
        dsc_fee=data.dsc_fee,
        rto_fee=data.rto_fee,
        first_emi_date=data.first_emi_date,
        # penalty_rate defaults to 36.00 from the DB; admin can override via update.
        status=LoanStatus.DRAFT,
        created_by_id=created_by,
    )
    db.add(loan)
    try:
        db.commit()
        db.refresh(loan)
        return loan
    except IntegrityError as e:
        db.rollback()
        # L2 fix: don't string-match e.orig. The loan_number is a UUID slice
        # and collisions are vanishingly rare; treat any IntegrityError here
        # as a generic uniqueness/constraint failure with a non-leaking
        # message. The route returns 409.
        raise ValueError(safe_integrity_message(e)) from None


def approve_loan(
    db: Session,
    loan: Loan,
    approved_by: uuid.UUID,
    down_payment_mode: Optional[str] = None,
    *,
    approval_date: Optional[date] = None,
    first_emi_date: Optional[date] = None,
    request: Optional[Request] = None,
) -> Loan:
    """
    Transition a DRAFT loan to ACTIVE.

    Atomically:
      - Stamps approval_date (today unless backdated) and, from the required
        first-EMI date, first_emi_date + due_day_of_month.
      - Generates 1..tenure DueCycle rows starting on the first-EMI date, with
        the agreed last-day-of-month fallback for short months.
      - If the loan has a down payment, creates a DOWN_PAYMENT transaction
        with status=SUCCESS, punctuality=PAID_ON_TIME, effective_date=today,
        allocated to cycle 1 (which is automatically "ahead" by the DP amount).

    Raises:
      ValueError if loan is not in DRAFT, if no first-EMI date is available
      (neither on the loan nor in the approve body), or if down payment is set
      but `down_payment_mode` is missing.
    """
    if loan.status != LoanStatus.DRAFT:
        raise ValueError(
            f"Only DRAFT loans can be approved; this loan is {loan.status.value}"
        )

    if loan.principal is None or loan.interest_rate is None or loan.tenure is None:
        raise ValueError(
            "Set the loan's financial terms (principal, interest rate, tenure) before approving"
        )

    if not loan.hp_number:
        raise ValueError("Set the HP number before approving this finance")

    if loan.down_payment and loan.down_payment > 0 and not down_payment_mode:
        raise ValueError("down_payment_mode is required when down_payment > 0")

    today = date.today()
    # Approval date defaults to today, but the admin may backdate it to the real
    # iFinance origination date. Never allow a future date.
    eff_approval = approval_date or today
    if eff_approval > today:
        raise ValueError("Approval date cannot be in the future")

    # The first-EMI date ("Due date") anchors the whole schedule and is required
    # to approve. Prefer an override in the approve body (admin can adjust at the
    # moment of approval); otherwise use the value captured at creation.
    eff_first_emi = first_emi_date or loan.first_emi_date
    if eff_first_emi is None:
        raise ValueError("Set the due date (first EMI date) before approving this finance")
    if eff_first_emi < eff_approval:
        raise ValueError("Due date cannot be before the approval date")

    before = _loan_audit_snapshot(loan)

    loan.approval_date = eff_approval
    loan.first_emi_date = eff_first_emi
    loan.due_day_of_month = eff_first_emi.day
    loan.status = LoanStatus.ACTIVE
    loan.updated_by_id = approved_by

    # Generate due cycles (cycles are added to session, not yet committed).
    cycles = generate_cycles_for_loan(
        db, loan, approved_by=approved_by, first_emi_date=eff_first_emi
    )

    # Flush so the cycles have IDs we can reference in the DP transaction.
    db.flush()

    if loan.down_payment and loan.down_payment > 0:
        first_cycle = cycles[0] if cycles else None
        db.add(
            Transaction(
                loan_id=loan.id,
                amount=loan.down_payment,
                payment_mode=down_payment_mode,
                transaction_type=TransactionType.DOWN_PAYMENT,
                status=TransactionStatus.SUCCESS,
                punctuality_status=PunctualityStatus.PAID_ON_TIME,
                effective_payment_date=eff_approval,
                due_cycle_id=first_cycle.id if first_cycle else None,
                collected_by_id=approved_by,
                created_by_id=approved_by,
            )
        )
        # The DP is a SUCCESS payment that lands on cycle 1 (or rolls forward
        # as credit). Keep the cycle's running total in sync from the start.
        if first_cycle is not None:
            db.flush()
            # Local import avoids loan ↔ transaction circular import at module load.
            from app.services.transaction import recompute_cycle_totals

            recompute_cycle_totals(db, first_cycle)

    write_audit(
        db,
        action_type="LOAN_APPROVE",
        target_table="loans",
        record_id=loan.id,
        user_id=approved_by,
        old_data=before,
        new_data={
            **_loan_audit_snapshot(loan),
            "down_payment_mode": down_payment_mode,
        },
        request=request,
    )
    db.commit()
    db.refresh(loan)
    return loan


def update_loan(
    db: Session,
    loan: Loan,
    data: LoanUpdate,
    updated_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> Loan:
    """
    Update a loan. Defense-in-depth: the service refuses edits on loans that
    are not in DRAFT or ACTIVE — even if a caller skips the route's guard
    (review items L1/L2). Approval-date is never settable here.
    """
    if loan.status not in (LoanStatus.DRAFT, LoanStatus.ACTIVE):
        raise ValueError(
            f"Loan in status {loan.status.value} is immutable. "
            "Edits are only permitted in DRAFT or ACTIVE."
        )

    changes = data.model_dump(exclude_unset=True)
    fields_changed = sorted(changes.keys())

    # Collateral swaps need the same eligibility check as loan creation.
    # Once a loan is ACTIVE the collateral is locked — swapping it out would
    # break the audit chain between vehicle, schedule and disbursement.
    if "vehicle_id" in changes:
        new_vehicle_id = changes["vehicle_id"]
        if new_vehicle_id != loan.vehicle_id:
            if loan.status == LoanStatus.ACTIVE:
                raise ValueError(
                    "Cannot change collateral on an ACTIVE loan"
                )
            if new_vehicle_id is not None:
                _resolve_pledgeable_vehicle(db, new_vehicle_id)

    # The first-EMI date ("Due date") anchors the repayment schedule. On a DRAFT
    # there are no cycles yet, so it's a plain field write. On an ACTIVE loan an
    # admin may correct it, but the change must re-anchor the already-generated
    # schedule (done below) — and an active loan can never be left with no due
    # date, nor one before its origination.
    old_first_emi = loan.first_emi_date
    reanchor_needed = (
        "first_emi_date" in changes
        and loan.status == LoanStatus.ACTIVE
        and changes["first_emi_date"] != old_first_emi
    )
    if "first_emi_date" in changes and loan.status == LoanStatus.ACTIVE:
        new_first_emi = changes["first_emi_date"]
        if new_first_emi is None:
            raise ValueError("An active finance must keep a due date")
        if loan.approval_date is not None and new_first_emi < loan.approval_date:
            raise ValueError("Due date cannot be before the approval date")

    before = _loan_audit_snapshot(loan)
    for field, value in changes.items():
        setattr(loan, field, value)

    # Re-date every cycle onto the new anchor (amounts/payments untouched).
    if reanchor_needed:
        loan.due_day_of_month = loan.first_emi_date.day
        reanchor_cycles(db, loan, updated_by)

    loan.updated_by_id = updated_by
    db.flush()
    write_audit(
        db,
        action_type="LOAN_UPDATE",
        target_table="loans",
        record_id=loan.id,
        user_id=updated_by,
        old_data=before,
        new_data={**_loan_audit_snapshot(loan), "fields_changed": fields_changed},
        request=request,
    )
    db.commit()
    db.refresh(loan)
    return loan


# L1 fix: `mark_bad_debt` removed. Bad-debt status is now reached via the
# two-step propose / review flow (see app/services/bad_debt.py) followed
# by close_loan with closure_type=WRITE_OFF (see app/services/loan_closure.py).
# Keeping a public direct-write function alongside the proper flow was a
# footgun — anyone importing it would silently bypass approval + audit.


def soft_delete_loan(
    db: Session,
    loan: Loan,
    deleted_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> Loan:
    # AuditBase.soft_delete sets is_deleted/deleted_at/deleted_by_id/updated_by_id
    # atomically (satisfies the check_soft_delete_loans CHECK).
    snapshot = _loan_audit_snapshot(loan)
    loan.soft_delete(deleted_by)
    db.flush()
    write_audit(
        db,
        action_type="LOAN_DELETE",
        target_table="loans",
        record_id=loan.id,
        user_id=deleted_by,
        old_data=snapshot,
        request=request,
    )
    db.commit()
    return loan
