"""
Reports service — read-only aggregations across the modular monolith.

Conventions:
  - EMI buckets group on Transaction.effective_payment_date (a DATE,
    timezone-independent), so admin-attested business dates drive reports.
  - "New customers / new loans" buckets group on created_at, converted
    to the configured REPORTS_TIMEZONE so IST midnight-edge rows land
    in the correct month.
  - Outstanding / payable / pending are derived from the due_cycles
    ledger over OPEN_LOAN_STATUSES (loans where money is still owed).
  - DOWN_PAYMENT transactions are excluded from every "collection" sum;
    they are origination cash, not EMI collection.
"""
import uuid
from decimal import Decimal
from datetime import date, datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.customer import Customer
from app.models.document import Document
from app.models.due_cycle import DueCycle
from app.models.loan import Loan, LoanStatus
from app.models.transaction import (
    PaymentMethod,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.models.cash_entry import CASH_IN_TYPES, CashEntryType
from app.models.user import User
from app.models.vehicle import AssetStatus, Vehicle
from app.services.cash_entry import (
    cash_entries_in_range,
    cash_entry_net_before,
    cash_entry_type_sums,
    expense_category_sums,
)
from app.services.finance import total_payable as calc_total_payable
from app.utils.time import today_in_tz


def _today() -> date:
    """Calendar today in the configured reports timezone (Asia/Kolkata by default)."""
    return today_in_tz(settings.REPORTS_TIMEZONE)


def _local_midnight_utc(d: date) -> datetime:
    """
    Return the UTC timestamp that corresponds to 00:00 of `d` in the configured
    reporting timezone.

    Use this when you need to filter a `timestamptz` column against a date that
    you computed in the reporting timezone. Comparing `created_at >= <date>`
    directly promotes the date to UTC midnight and silently drops rows in the
    IST/UTC offset gap (e.g. a row created at 23:00 UTC on May 31 is 04:30 IST
    on June 1 — belongs in the June IST bucket but `>= 2025-06-01 00:00 UTC`
    is false).
    """
    return datetime.combine(d, time.min, tzinfo=ZoneInfo(settings.REPORTS_TIMEZONE))


# --------------------------------------------------
# CONSTANTS
# --------------------------------------------------
# Loan statuses where money is still owed and a due-cycle ledger is live.
# Reports derive outstanding / payable / pending from these only.
OPEN_LOAN_STATUSES = (
    LoanStatus.ACTIVE,
    LoanStatus.AWAITING_CLOSURE,
    LoanStatus.BAD_DEBT_PROPOSED,
)

# Payment modes broken out as their own columns in the collection report.
# Any PaymentMethod not in this tuple falls into the `other` bucket so the
# row-level invariant (cash + gpay + phonepe + bank_transfer + other = total)
# survives the addition of new enum values without a code change here.
_BREAKDOWN_MODES = (
    PaymentMethod.CASH,
    PaymentMethod.GPAY,
    PaymentMethod.PHONEPE,
    PaymentMethod.BANK_TRANSFER,
)

_ZERO = Decimal("0.00")


def _d(value) -> Decimal:
    """Coerce a SQL numeric result to Decimal, treating None as 0.00."""
    if value is None:
        return _ZERO
    return Decimal(str(value))


# A loan's net outstanding, as a SQL expression: greatest(Σ total_due −
# Σ total_received, 0) over its cycles. This nets an OVERPAID cycle against
# UNDERPAID ones on the SAME loan — a customer who prepays an EMI genuinely owes
# less — so a prepayment reduces the balance owed instead of sitting clamped on
# one cycle. It is deliberately NOT the per-cycle shortfall the collections
# worklist uses (`Σ max(total_due − total_received, 0)`): that clamp is correct
# for "what is overdue" but overstates the receivable as an ASSET, which broke
# the balance sheet (assets counted a prepayment on both sides). Matches the
# loan-summary endpoint's `total_payable − total_paid`. MUST be used under
# GROUP BY the loan.
def _loan_net_outstanding():
    return func.greatest(
        func.coalesce(func.sum(DueCycle.total_due), 0)
        - func.coalesce(func.sum(DueCycle.total_received), 0),
        0,
    )


def _loan_net_outstanding_subq(db: Session, statuses=OPEN_LOAN_STATUSES):
    """Subquery of (loan_id, outstanding) — each loan's net outstanding (see
    `_loan_net_outstanding`) over non-deleted cycles of non-deleted loans in
    `statuses`. Sum its `outstanding` column for a portfolio total that nets
    per loan rather than per cycle."""
    return (
        db.query(
            DueCycle.loan_id.label("loan_id"),
            _loan_net_outstanding().label("outstanding"),
        )
        .join(Loan, Loan.id == DueCycle.loan_id)
        .filter(
            DueCycle.is_deleted == False,
            Loan.is_deleted == False,
            Loan.status.in_(statuses),
        )
        .group_by(DueCycle.loan_id)
        .subquery()
    )


# --------------------------------------------------
# FEE & PENALTY INCOME (accrual recognition)
# --------------------------------------------------
# The four one-off loan charges and late-payment penalties are recognised as
# income when CHARGED (accrual). Both already sit inside the ASSET side today —
# fees are kept in cash at disbursement (principal is booked out gross), and
# penalties inflate the receivable via due_cycles.total_due — but neither had a
# matching income line, which left the balance sheet unreconciled. These helpers
# supply the funding-side terms. See get_balance_sheet / get_pnl.


def _fee_income_total(
    db: Session, date1: Optional[date] = None, date2: Optional[date] = None
) -> Decimal:
    """Σ (processing + documentation + dsc + rto) fees over non-deleted, non-DRAFT
    loans. Optional approval-date window (used by the windowed P&L; the balance
    sheet passes none for all-time)."""
    q = db.query(
        func.coalesce(
            func.sum(
                Loan.processing_fee
                + Loan.documentation_fee
                + Loan.dsc_fee
                + Loan.rto_fee
            ),
            0,
        )
    ).filter(Loan.is_deleted == False, Loan.status != LoanStatus.DRAFT)
    if date1 is not None:
        q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date >= date1)
    if date2 is not None:
        q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date <= date2)
    return _d(q.scalar())


def _penalty_charged_by_loan(db: Session, statuses=OPEN_LOAN_STATUSES) -> dict:
    """{loan_id: Σ DueCycle.penalty_amount} — total late-payment penalty CHARGED
    on each loan in `statuses`. penalty_amount (not addon_from_penalties) is the
    genuinely new money a penalty creates; the addon also carries relocated
    shortfall. One grouped query."""
    rows = (
        db.query(
            DueCycle.loan_id,
            func.coalesce(func.sum(DueCycle.penalty_amount), 0),
        )
        .join(Loan, Loan.id == DueCycle.loan_id)
        .filter(
            DueCycle.is_deleted == False,
            Loan.is_deleted == False,
            Loan.status.in_(statuses),
        )
        .group_by(DueCycle.loan_id)
        .all()
    )
    return {loan_id: _d(total) for loan_id, total in rows}


def _penalty_income_total(
    db: Session, date1: Optional[date] = None, date2: Optional[date] = None
) -> Decimal:
    """Σ DueCycle.penalty_amount over OPEN loans — the penalty recognised as
    income. Open-only is deliberate: a loan that flips to BAD_DEBT drops out of
    this sum, which IS the accrual reversal (its penalty leaves both the open
    receivable and this income line together). Optional approval-date window for
    the P&L."""
    q = (
        db.query(func.coalesce(func.sum(DueCycle.penalty_amount), 0))
        .join(Loan, Loan.id == DueCycle.loan_id)
        .filter(
            DueCycle.is_deleted == False,
            Loan.is_deleted == False,
            Loan.status.in_(OPEN_LOAN_STATUSES),
        )
    )
    if date1 is not None:
        q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date >= date1)
    if date2 is not None:
        q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date <= date2)
    return _d(q.scalar())


def _local_month(column):
    """
    YYYY-MM bucket from a timestamptz column converted to the configured
    reporting timezone (IST by default). Without the AT TIME ZONE cast,
    Postgres uses the session timezone — which in production is usually
    UTC, shifting late-night IST rows into the next month.
    """
    return func.to_char(
        func.timezone(settings.REPORTS_TIMEZONE, column), "YYYY-MM"
    )


# --------------------------------------------------
# DASHBOARD SUMMARY
# --------------------------------------------------
def get_dashboard_summary(db: Session) -> dict:
    """High level overview for admin dashboard."""

    total_customers = (
        db.query(func.count(Customer.id)).filter(Customer.is_deleted == False).scalar()
    )

    status_counts = dict(
        db.query(Loan.status, func.count(Loan.id))
        .filter(Loan.is_deleted == False)
        .group_by(Loan.status)
        .all()
    )

    total_vehicles = (
        db.query(func.count(Vehicle.id)).filter(Vehicle.is_deleted == False).scalar()
    )

    total_documents = (
        db.query(func.count(Document.id)).filter(Document.is_deleted == False).scalar()
    )

    # --- Source of truth: due_cycles ledger for open loans -------------------
    # total_due:     scheduled obligation (base_emi + penalty add-ons)
    # total_received: SUCCESS REGULAR transactions allocated to the cycle
    # Outstanding is netted PER LOAN (prepayments offset later shortfalls), not
    # floored per cycle — see _loan_net_outstanding. Summing the per-loan subq
    # keeps this in step with HP Outstanding and the balance sheet.
    _net_sq = _loan_net_outstanding_subq(db)
    total_outstanding = _d(
        db.query(func.coalesce(func.sum(_net_sq.c.outstanding), 0)).scalar()
    )

    # Lifetime EMI collected — REGULAR, SUCCESS, non-deleted transactions
    # across all (non-deleted) loans. Down-payments are excluded because they
    # represent loan-origination cash, not EMI collection. CLOSED loans are
    # included so historical collections don't disappear when a loan closes.
    total_collected = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .join(Loan, Loan.id == Transaction.loan_id)
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.REGULAR,
            Transaction.is_deleted == False,
            Loan.is_deleted == False,
        )
        .scalar()
    )

    return {
        "total_customers": total_customers or 0,
        "total_draft_loans": status_counts.get(LoanStatus.DRAFT, 0),
        "total_active_loans": status_counts.get(LoanStatus.ACTIVE, 0),
        "total_awaiting_closure_loans": status_counts.get(
            LoanStatus.AWAITING_CLOSURE, 0
        ),
        "total_closed_loans": status_counts.get(LoanStatus.CLOSED, 0),
        "total_bad_debt_proposed_loans": status_counts.get(
            LoanStatus.BAD_DEBT_PROPOSED, 0
        ),
        "total_bad_debt_loans": status_counts.get(LoanStatus.BAD_DEBT, 0),
        "total_vehicles": total_vehicles or 0,
        "total_documents": total_documents or 0,
        # Pending = unpaid portion of the open-loan due-cycle ledger.
        # This replaces the old (incorrect) "PENDING transactions sum",
        # which meant "transactions still processing", not "money still owed".
        "total_pending_collections": total_outstanding,
        # Kept as alias for the same number — frontend may surface either.
        "total_principal_outstanding": total_outstanding,
        "total_amount_collected": _d(total_collected),
        # Accrued income the standalone reports recognise (all-time), so the
        # dashboard can show toggleable Fee / Penalty income tiles.
        "fee_income": _fee_income_total(db),
        "penalty_income": _penalty_income_total(db),
    }


# --------------------------------------------------
# LOAN PORTFOLIO
# --------------------------------------------------
def get_loan_portfolio(db: Session) -> dict:

    stats = (
        db.query(
            func.count(Loan.id),
            func.coalesce(func.sum(Loan.principal), 0),
            func.avg(Loan.interest_rate),
            func.avg(Loan.tenure),
        )
        .filter(Loan.is_deleted == False)
        .first()
    )

    status_counts = dict(
        db.query(Loan.status, func.count(Loan.id))
        .filter(Loan.is_deleted == False)
        .group_by(Loan.status)
        .all()
    )

    # Open-loan ledger totals (source of truth — see get_dashboard_summary).
    # payable/collected are portfolio-wide cycle sums; outstanding is netted per
    # loan (see _loan_net_outstanding) so it agrees with HP Outstanding.
    cycle_totals = (
        db.query(
            func.coalesce(func.sum(DueCycle.total_due), 0).label("payable"),
            func.coalesce(func.sum(DueCycle.total_received), 0).label("collected"),
        )
        .join(Loan, Loan.id == DueCycle.loan_id)
        .filter(
            DueCycle.is_deleted == False,
            Loan.is_deleted == False,
            Loan.status.in_(OPEN_LOAN_STATUSES),
        )
        .first()
    )
    _net_sq = _loan_net_outstanding_subq(db)
    total_outstanding = _d(
        db.query(func.coalesce(func.sum(_net_sq.c.outstanding), 0)).scalar()
    )

    total_loans = stats[0] or 0
    total_principal = _d(stats[1])
    avg_rate = stats[2] or 0
    avg_tenure = stats[3] or 0

    return {
        "total_loans": total_loans,
        "draft_loans": status_counts.get(LoanStatus.DRAFT, 0),
        "active_loans": status_counts.get(LoanStatus.ACTIVE, 0),
        "awaiting_closure_loans": status_counts.get(LoanStatus.AWAITING_CLOSURE, 0),
        "closed_loans": status_counts.get(LoanStatus.CLOSED, 0),
        "bad_debt_proposed_loans": status_counts.get(LoanStatus.BAD_DEBT_PROPOSED, 0),
        "bad_debt_loans": status_counts.get(LoanStatus.BAD_DEBT, 0),
        "total_principal": total_principal,
        # Real "payable" = principal + interest + penalty add-ons, sourced
        # from due_cycles.total_due for currently-open loans.
        "total_payable": _d(cycle_totals.payable if cycle_totals else 0),
        "total_collected": _d(cycle_totals.collected if cycle_totals else 0),
        "total_outstanding": total_outstanding,
        "average_interest_rate": Decimal(str(avg_rate)).quantize(Decimal("0.01")),
        "average_tenure": Decimal(str(avg_tenure)).quantize(Decimal("0.1")),
    }


# --------------------------------------------------
# COLLECTIONS REPORT
# --------------------------------------------------
def get_collection_report(
    db: Session,
    period: str = "daily",
    days: int = 30,
    date1: Optional[date] = None,
    date2: Optional[date] = None,
) -> dict:
    """
    Collection report grouped by day or month.

    An explicit [date1, date2] window takes precedence over the rolling `days`
    lookback; `days` stays the default so existing callers are unaffected.

    Grouped by Transaction.effective_payment_date (the business date the
    admin attests as the true date of payment), NOT created_at — so a cash
    payment received on the 28th but entered on the 1st of next month still
    lands in the correct reporting period.

    DOWN_PAYMENT transactions are excluded — they represent origination cash,
    not EMI collection.

    Per-row invariant: cash + gpay + phonepe + bank_transfer + other = total
    (the `other` bucket catches any PaymentMethod added to the enum without
    a corresponding breakdown column here).
    """

    since = date1 if date1 is not None else _today() - timedelta(days=days)

    if period == "daily":
        date_group = Transaction.effective_payment_date
    else:
        # YYYY-MM bucket from a DATE column — tz-independent
        date_group = func.to_char(Transaction.effective_payment_date, "YYYY-MM")

    def _mode_sum(mode: PaymentMethod):
        return func.coalesce(
            func.sum(
                case((Transaction.payment_mode == mode, Transaction.amount), else_=0)
            ),
            0,
        )

    # SUM(amount) where payment_mode NOT IN known modes — i.e. enum values
    # added after this code was written. Falls into the `other` bucket so
    # the row reconciles regardless.
    other_sum = func.coalesce(
        func.sum(
            case(
                (
                    Transaction.payment_mode.notin_(_BREAKDOWN_MODES),
                    Transaction.amount,
                ),
                else_=0,
            )
        ),
        0,
    )

    q = db.query(
        date_group.label("date"),
        func.count(Transaction.id).label("count"),
        func.coalesce(func.sum(Transaction.amount), 0).label("total"),
        _mode_sum(PaymentMethod.CASH).label("cash"),
        _mode_sum(PaymentMethod.GPAY).label("gpay"),
        _mode_sum(PaymentMethod.PHONEPE).label("phonepe"),
        _mode_sum(PaymentMethod.BANK_TRANSFER).label("bank_transfer"),
        other_sum.label("other"),
    ).filter(
        Transaction.is_deleted == False,
        Transaction.status == TransactionStatus.SUCCESS,
        Transaction.transaction_type == TransactionType.REGULAR,
        Transaction.effective_payment_date >= since,
    )
    if date2 is not None:
        q = q.filter(Transaction.effective_payment_date <= date2)

    results = q.group_by(date_group).order_by(date_group.desc()).all()

    entries = [
        {
            "date": str(r.date),
            "total_amount": _d(r.total),
            "transaction_count": r.count,
            "cash": _d(r.cash),
            "gpay": _d(r.gpay),
            "phonepe": _d(r.phonepe),
            "bank_transfer": _d(r.bank_transfer),
            "other": _d(r.other),
        }
        for r in results
    ]

    total_collected = sum((e["total_amount"] for e in entries), _ZERO)

    return {
        "period": period,
        "total_collected": total_collected,
        "total_transactions": sum(e["transaction_count"] for e in entries),
        "entries": entries,
    }


# --------------------------------------------------
# CUSTOMER REPORT
# --------------------------------------------------
def _customer_report_query(
    db: Session,
    assigned_employee_id: Optional[uuid.UUID] = None,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = None,
    date1: Optional[date] = None,
    date2: Optional[date] = None,
):
    """
    Shared SQL composition for the customer report.

    Returns a SQLAlchemy Query yielding rows with columns:
      (id, full_name, mobile_number, active_loans, principal, paid, outstanding)
    sorted by outstanding DESC NULLS LAST.

    Used by both the paginated JSON endpoint and the streaming CSV export
    so the two never drift.

    When `assigned_employee_id` is provided, the result is scoped to
    customers assigned to that employee — used to enforce per-EMPLOYEE
    visibility at the report layer.

    `date1`/`date2` scope every aggregate to loans approved in that window and
    drop customers with no such loan, answering "who did we finance in this
    period, and where do those loans stand now".
    """

    def _cohort(q):
        if date1 is not None:
            q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date >= date1)
        if date2 is not None:
            q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date <= date2)
        return q

    loan_sub = _cohort(
        db.query(
            Loan.customer_id,
            func.count(Loan.id).label("active_loans"),
            func.coalesce(func.sum(Loan.principal), 0).label("principal"),
        ).filter(Loan.status.in_(OPEN_LOAN_STATUSES), Loan.is_deleted == False)
    ).group_by(Loan.customer_id).subquery()

    paid_sub = _cohort(
        db.query(
            Loan.customer_id,
            func.coalesce(func.sum(Transaction.amount), 0).label("paid"),
        )
        .join(Transaction, Transaction.loan_id == Loan.id)
        .filter(
            Loan.status.in_(OPEN_LOAN_STATUSES),
            Loan.is_deleted == False,
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.REGULAR,
            Transaction.is_deleted == False,
        )
    ).group_by(Loan.customer_id).subquery()

    # Net per loan first (prepayments offset later shortfalls — see
    # _loan_net_outstanding), then roll up to the customer; a per-cycle floor
    # would overstate the balance the same way it did on the balance sheet.
    loan_net_sub = (
        _cohort(
            db.query(
                Loan.customer_id.label("customer_id"),
                DueCycle.loan_id.label("loan_id"),
                _loan_net_outstanding().label("outstanding"),
            )
            .join(DueCycle, DueCycle.loan_id == Loan.id)
            .filter(
                Loan.status.in_(OPEN_LOAN_STATUSES),
                Loan.is_deleted == False,
                DueCycle.is_deleted == False,
            )
        )
        .group_by(Loan.customer_id, DueCycle.loan_id)
        .subquery()
    )
    outstanding_sub = (
        db.query(
            loan_net_sub.c.customer_id,
            func.coalesce(func.sum(loan_net_sub.c.outstanding), 0).label("outstanding"),
        )
        .group_by(loan_net_sub.c.customer_id)
        .subquery()
    )

    q = (
        db.query(
            Customer.id,
            Customer.full_name,
            Customer.mobile_number,
            func.coalesce(loan_sub.c.active_loans, 0).label("active_loans"),
            func.coalesce(loan_sub.c.principal, 0).label("principal"),
            func.coalesce(paid_sub.c.paid, 0).label("paid"),
            func.coalesce(outstanding_sub.c.outstanding, 0).label("outstanding"),
        )
        .outerjoin(loan_sub, loan_sub.c.customer_id == Customer.id)
        .outerjoin(paid_sub, paid_sub.c.customer_id == Customer.id)
        .outerjoin(outstanding_sub, outstanding_sub.c.customer_id == Customer.id)
        .filter(Customer.is_deleted == False)
    )

    if assigned_employee_id is not None:
        q = q.filter(Customer.assigned_employee_id == assigned_employee_id)

    # A cohort window is about the customers financed in it, so drop the ones
    # the outer join left empty instead of listing every customer at zero.
    if date1 is not None or date2 is not None:
        q = q.filter(loan_sub.c.customer_id.isnot(None))

    # Sortable columns. The aggregate columns are coalesced to 0 (matching the
    # displayed values), so NULLs from the outer joins sort as 0 — no explicit
    # NULL placement needed. Unknown/absent sort_by falls back to the default
    # (outstanding desc), keeping the CSV stream and old callers unchanged.
    sortable = {
        "full_name": Customer.full_name,
        "mobile_number": Customer.mobile_number,
        "active_loans": func.coalesce(loan_sub.c.active_loans, 0),
        "principal": func.coalesce(loan_sub.c.principal, 0),
        "paid": func.coalesce(paid_sub.c.paid, 0),
        "outstanding": func.coalesce(outstanding_sub.c.outstanding, 0),
    }
    column = sortable.get(sort_by or "outstanding", sortable["outstanding"])
    descending = (sort_order or "desc").lower() != "asc"
    ordering = column.desc() if descending else column.asc()

    # Secondary key on Customer.id keeps the order stable across pages when
    # multiple customers share the same sort value (very common at 0.00),
    # so OFFSET/LIMIT pagination and the CSV stream don't skip/duplicate rows.
    return q.order_by(ordering, Customer.id.asc())


def _customer_row_to_dict(r) -> dict:
    return {
        "customer_id": str(r.id),
        "customer_name": r.full_name,
        "mobile_number": r.mobile_number,
        "active_loans": r.active_loans,
        "total_principal": _d(r.principal),
        "total_paid": _d(r.paid),
        "total_outstanding": _d(r.outstanding),
    }


def get_customer_report(
    db: Session,
    page: int = 1,
    page_size: int = 50,
    assigned_employee_id: Optional[uuid.UUID] = None,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = None,
    date1: Optional[date] = None,
    date2: Optional[date] = None,
) -> dict:
    """
    Per-customer roll-up. Paginated.

    Outstanding is sourced from due_cycles (the canonical ledger) for loans
    in OPEN_LOAN_STATUSES. "Active loans" counts loans in those same
    open statuses. "Paid" counts SUCCESS REGULAR transactions on those loans.

    `assigned_employee_id`, when provided, scopes the report to that
    employee's assigned customers (used to enforce EMPLOYEE-role visibility).

    `date1`/`date2` restrict to customers financed in that window; both the
    header counts and the rows follow the same cohort.
    """
    query = _customer_report_query(
        db,
        assigned_employee_id=assigned_employee_id,
        sort_by=sort_by,
        sort_order=sort_order,
        date1=date1,
        date2=date2,
    )

    total_q = db.query(func.count(Customer.id)).filter(Customer.is_deleted == False)
    active_q = (
        db.query(func.count(func.distinct(Loan.customer_id)))
        .join(Customer, Customer.id == Loan.customer_id)
        .filter(
            Loan.status.in_(OPEN_LOAN_STATUSES),
            Loan.is_deleted == False,
            Customer.is_deleted == False,
        )
    )
    if assigned_employee_id is not None:
        total_q = total_q.filter(Customer.assigned_employee_id == assigned_employee_id)
        active_q = active_q.filter(
            Customer.assigned_employee_id == assigned_employee_id
        )

    if date1 is not None or date2 is not None:
        # Within a cohort both headline counts describe the same financed set,
        # so the "total" is a distinct-customer count over the window too.
        cohort_q = active_q
        if date1 is not None:
            cohort_q = cohort_q.filter(
                Loan.approval_date.isnot(None), Loan.approval_date >= date1
            )
        if date2 is not None:
            cohort_q = cohort_q.filter(
                Loan.approval_date.isnot(None), Loan.approval_date <= date2
            )
        active_q = cohort_q
        total_q = cohort_q

    total = total_q.scalar() or 0
    customers_with_active_loans = active_q.scalar() or 0

    rows = query.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "total_customers": total,
        "customers_with_active_loans": customers_with_active_loans,
        "page": page,
        "page_size": page_size,
        "results": [_customer_row_to_dict(r) for r in rows],
    }


def iter_customer_report_rows(
    db: Session,
    assigned_employee_id: Optional[uuid.UUID] = None,
):
    """
    Stream customer-report rows from the DB without materialising the full
    set in Python. Used by the CSV export so a 100k-customer tenant doesn't
    OOM the worker.

    yield_per(500) tells SQLAlchemy to fetch the result in chunks rather
    than buffering all rows server-side.
    """
    query = _customer_report_query(
        db, assigned_employee_id=assigned_employee_id
    ).execution_options(yield_per=500)
    for r in query:
        yield _customer_row_to_dict(r)


def count_customers(
    db: Session,
    assigned_employee_id: Optional[uuid.UUID] = None,
) -> int:
    """Eligible non-deleted customers — used for audit-row count metadata."""
    q = db.query(func.count(Customer.id)).filter(Customer.is_deleted == False)
    if assigned_employee_id is not None:
        q = q.filter(Customer.assigned_employee_id == assigned_employee_id)
    return q.scalar() or 0


# --------------------------------------------------
# EMPLOYEE PERFORMANCE
# --------------------------------------------------
def get_employee_report(
    db: Session, date1: Optional[date] = None, date2: Optional[date] = None
) -> dict:
    """
    Per-user collection performance, optionally limited to collections whose
    effective_payment_date falls in [date1, date2]. Omitting both is all-time.

    Includes soft-deleted / deactivated users that still have transactions
    or assigned customers, so historical collections don't disappear when
    an employee leaves. Each row carries `is_active` so the UI can render
    former employees distinctly.

    Only REGULAR collections count — DOWN_PAYMENT cash handed at disbursal
    isn't a "collection".

    `assigned_customers` stays a live count: customer assignment carries no
    history, so it cannot be reconstructed for a past window.
    """

    assigned_sub = (
        db.query(
            Customer.assigned_employee_id.label("emp_id"),
            func.count(Customer.id).label("cnt"),
        )
        .filter(
            Customer.is_deleted == False,
            Customer.assigned_employee_id.isnot(None),
        )
        .group_by(Customer.assigned_employee_id)
        .subquery()
    )

    collections_q = db.query(
        Transaction.collected_by_id.label("emp_id"),
        func.coalesce(func.sum(Transaction.amount), 0).label("total_amount"),
        func.count(Transaction.id).label("txn_count"),
    ).filter(
        Transaction.status == TransactionStatus.SUCCESS,
        Transaction.transaction_type == TransactionType.REGULAR,
        Transaction.is_deleted == False,
        Transaction.collected_by_id.isnot(None),
    )
    if date1 is not None:
        collections_q = collections_q.filter(Transaction.effective_payment_date >= date1)
    if date2 is not None:
        collections_q = collections_q.filter(Transaction.effective_payment_date <= date2)
    collections_sub = collections_q.group_by(Transaction.collected_by_id).subquery()

    rows = (
        db.query(
            User.id,
            User.username,
            User.role,
            User.is_active,
            User.is_deleted,
            func.coalesce(assigned_sub.c.cnt, 0).label("assigned_customers"),
            func.coalesce(collections_sub.c.total_amount, 0).label("total_collections"),
            func.coalesce(collections_sub.c.txn_count, 0).label("transaction_count"),
        )
        .outerjoin(assigned_sub, assigned_sub.c.emp_id == User.id)
        .outerjoin(collections_sub, collections_sub.c.emp_id == User.id)
        # Keep deactivated / soft-deleted users that have history; drop
        # only the truly noise rows (deleted/inactive AND no history).
        .filter(
            (User.is_deleted == False)
            | (assigned_sub.c.cnt > 0)
            | (collections_sub.c.txn_count > 0)
        )
        .all()
    )

    results = [
        {
            "employee_id": str(r.id),
            "employee_name": r.username,
            "role": r.role,
            "is_active": bool(r.is_active) and not bool(r.is_deleted),
            "assigned_customers": r.assigned_customers,
            "total_collections": _d(r.total_collections),
            "transaction_count": r.transaction_count,
        }
        for r in rows
    ]
    results.sort(key=lambda x: x["total_collections"], reverse=True)

    return {
        "total_employees": len(results),
        "total_collections": sum(
            (r["total_collections"] for r in results), _ZERO
        ),
        "total_transactions": sum(r["transaction_count"] for r in results),
        "results": results,
    }


def get_collection_by_collector(db: Session, date1: date, date2: date) -> dict:
    """
    Per-collector collections over [date1, date2] (inclusive) — the app's twin of
    iFinance's date-ranged Collection Report. REGULAR SUCCESS receipts only,
    bucketed on effective_payment_date, grouped by the collecting user, with the
    payment-mode split and TA broken out. Collectors with no receipts in the
    window are omitted.
    """
    def _mode(mode: PaymentMethod):
        return func.coalesce(
            func.sum(case((Transaction.payment_mode == mode, Transaction.amount), else_=0)),
            0,
        )

    rows = (
        db.query(
            User.id,
            User.username,
            User.role,
            User.is_active,
            User.is_deleted,
            func.coalesce(func.sum(Transaction.amount), 0).label("total_amount"),
            func.coalesce(func.sum(Transaction.ta_amount), 0).label("ta_amount"),
            func.count(Transaction.id).label("txn_count"),
            _mode(PaymentMethod.CASH).label("cash"),
            _mode(PaymentMethod.GPAY).label("gpay"),
            _mode(PaymentMethod.PHONEPE).label("phonepe"),
            _mode(PaymentMethod.BANK_TRANSFER).label("bank_transfer"),
        )
        .join(Transaction, Transaction.collected_by_id == User.id)
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.REGULAR,
            Transaction.is_deleted == False,
            Transaction.effective_payment_date >= date1,
            Transaction.effective_payment_date <= date2,
        )
        .group_by(User.id, User.username, User.role, User.is_active, User.is_deleted)
        .all()
    )

    results = []
    for r in rows:
        breakdown = _d(r.cash) + _d(r.gpay) + _d(r.phonepe) + _d(r.bank_transfer)
        results.append({
            "collector_id": str(r.id),
            "collector_name": r.username,
            "role": r.role,
            "is_active": bool(r.is_active) and not bool(r.is_deleted),
            "total_amount": _d(r.total_amount),
            "ta_amount": _d(r.ta_amount),
            "transaction_count": r.txn_count,
            "cash": _d(r.cash),
            "gpay": _d(r.gpay),
            "phonepe": _d(r.phonepe),
            "bank_transfer": _d(r.bank_transfer),
            "other": _d(r.total_amount) - breakdown,
        })
    results.sort(key=lambda x: x["total_amount"], reverse=True)

    return {
        "date1": date1,
        "date2": date2,
        "total_collected": sum((r["total_amount"] for r in results), _ZERO),
        "total_ta": sum((r["ta_amount"] for r in results), _ZERO),
        "total_transactions": sum(r["transaction_count"] for r in results),
        "results": results,
    }


# --------------------------------------------------
# Charts
# --------------------------------------------------
def _months_back_floor(months: int) -> date:
    """First day of the month that's `months` calendar months before today."""
    today = _today()
    target_month_index = today.month - 1 - (months - 1)
    target_year = today.year + target_month_index // 12
    target_month = target_month_index % 12 + 1
    return date(target_year, target_month, 1)


def get_collection_chart(db: Session, months: int = 12) -> list:
    """
    Monthly REGULAR collection totals — buckets on effective_payment_date.

    Window is the trailing `months` calendar months (default 12). Empty
    months in the window are zero-filled so the frontend renders a
    continuous series.
    """

    floor_date = _months_back_floor(months)
    month_col = func.to_char(Transaction.effective_payment_date, "YYYY-MM")

    rows = (
        db.query(
            month_col.label("month"),
            func.coalesce(func.sum(Transaction.amount), 0).label("amount"),
        )
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.REGULAR,
            Transaction.is_deleted == False,
            Transaction.effective_payment_date >= floor_date,
        )
        .group_by(month_col)
        .order_by(month_col)
        .all()
    )

    series = {r.month: _d(r.amount) for r in rows}

    # Build the exact `months`-long axis ending at the current month, regardless
    # of whether data exists in every slot.
    today = _today()
    axis: list[str] = []
    y, m = floor_date.year, floor_date.month
    while (y, m) <= (today.year, today.month):
        axis.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1

    return [{"month": m, "amount": series.get(m, _ZERO)} for m in axis]


# --------------------------------------------------
# Trends
# --------------------------------------------------
def get_monthly_trends(db: Session, months: int = 12) -> dict:
    """
    Month-over-month new customers, new loans, and EMI collections.

    All three series share a single zero-filled month axis derived from the
    union of their data months (or last 12 months for an empty DB), so the
    frontend can render aligned bars/lines without per-series gaps.

    new_customers / new_loans bucket on created_at converted to the configured
    reporting timezone (Asia/Kolkata by default). Without the AT TIME ZONE
    cast, a customer created at 23:30 IST on 31-Mar would land in April when
    the DB session timezone is UTC.

    Collections bucket on effective_payment_date (a DATE column, naturally
    timezone-independent) and exclude DOWN_PAYMENT.

    Window is the trailing `months` calendar months (default 12).
    """

    floor_date = _months_back_floor(months)
    # created_at is timestamptz; converting the IST floor to a real UTC
    # instant avoids dropping rows in the IST/UTC offset gap at the window's
    # start month (see _local_midnight_utc docstring).
    floor_ts = _local_midnight_utc(floor_date)

    cust_month_col = _local_month(Customer.created_at)
    customers_raw = (
        db.query(
            cust_month_col.label("month"),
            func.count(Customer.id).label("count"),
        )
        .filter(
            Customer.is_deleted == False,
            Customer.created_at >= floor_ts,
        )
        .group_by(cust_month_col)
        .all()
    )

    loan_month_col = _local_month(Loan.created_at)
    loans_raw = (
        db.query(
            loan_month_col.label("month"),
            func.count(Loan.id).label("count"),
        )
        .filter(
            Loan.is_deleted == False,
            Loan.created_at >= floor_ts,
        )
        .group_by(loan_month_col)
        .all()
    )

    coll_month_col = func.to_char(Transaction.effective_payment_date, "YYYY-MM")
    collections_raw = (
        db.query(
            coll_month_col.label("month"),
            func.coalesce(func.sum(Transaction.amount), 0).label("amount"),
        )
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.REGULAR,
            Transaction.is_deleted == False,
            Transaction.effective_payment_date >= floor_date,
        )
        .group_by(coll_month_col)
        .all()
    )

    customers_map = {r.month: r.count for r in customers_raw}
    loans_map = {r.month: r.count for r in loans_raw}
    collections_map = {r.month: _d(r.amount) for r in collections_raw}

    # Build the exact `months`-long axis ending at the current month.
    today = _today()
    axis: list[str] = []
    y, m = floor_date.year, floor_date.month
    while (y, m) <= (today.year, today.month):
        axis.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1

    return {
        "new_customers": [
            {"month": mo, "count": customers_map.get(mo, 0)} for mo in axis
        ],
        "new_loans": [
            {"month": mo, "count": loans_map.get(mo, 0)} for mo in axis
        ],
        "collections": [
            {"month": mo, "amount": collections_map.get(mo, _ZERO)} for mo in axis
        ],
    }


# --------------------------------------------------
# DAY REPORT (daily cash book)
# --------------------------------------------------
def _cash_position_before(db: Session, day: date) -> Decimal:
    """
    Net cash position from system-tracked money movements strictly before `day`:
    all SUCCESS receipts (REGULAR EMIs + DOWN_PAYMENTs) plus net capital &
    expense entries (cash_entries), minus all loan disbursements (principal of
    loans approved before `day`).
    """
    receipts = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .join(Loan, Loan.id == Transaction.loan_id)
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted == False,
            Loan.is_deleted == False,
            Transaction.effective_payment_date < day,
        )
        .scalar()
    )
    disbursed = (
        db.query(func.coalesce(func.sum(Loan.principal), 0))
        .filter(
            Loan.is_deleted == False,
            Loan.approval_date.isnot(None),
            Loan.approval_date < day,
        )
        .scalar()
    )
    return _d(receipts) - _d(disbursed) + cash_entry_net_before(db, day)


def get_day_report(db: Session, date1: date, date2: date) -> dict:
    """
    Daily cash book over [date1, date2] (inclusive), one section per day that
    had activity.

    Receipts   = SUCCESS transactions bucketed on effective_payment_date
                 (REGULAR EMIs and DOWN_PAYMENTs both count — a cash book
                 tracks money in, not just EMI collection), plus CAPITAL_IN /
                 OTHER_INCOME cash entries on entry_date.
    Payments   = loan disbursements (principal) bucketed on approval_date,
                 plus EXPENSE / CAPITAL_OUT cash entries on entry_date.
    Balances   roll forward day to day: closing(d) = opening(d) + receipts(d)
                 − payments(d); opening(date1) is the all-time net position
                 before date1 (see _cash_position_before).
    """
    receipt_rows = (
        db.query(Transaction, Loan, Customer, DueCycle, User)
        .join(Loan, Loan.id == Transaction.loan_id)
        .join(Customer, Customer.id == Loan.customer_id)
        .outerjoin(DueCycle, DueCycle.id == Transaction.due_cycle_id)
        .outerjoin(User, User.id == Transaction.collected_by_id)
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted == False,
            Loan.is_deleted == False,
            Transaction.effective_payment_date >= date1,
            Transaction.effective_payment_date <= date2,
        )
        .order_by(Transaction.effective_payment_date, Transaction.created_at)
        .all()
    )

    disbursement_rows = (
        db.query(Loan, Customer)
        .join(Customer, Customer.id == Loan.customer_id)
        .filter(
            Loan.is_deleted == False,
            Loan.approval_date.isnot(None),
            Loan.approval_date >= date1,
            Loan.approval_date <= date2,
            Loan.principal.isnot(None),
        )
        .order_by(Loan.approval_date, Loan.created_at)
        .all()
    )

    # Group both movement kinds by day, then roll balances forward.
    receipts_by_day: dict[date, list] = {}
    for txn, loan, customer, cycle, collector in receipt_rows:
        receipts_by_day.setdefault(txn.effective_payment_date, []).append(
            {
                "transaction_id": txn.id,
                "loan_id": loan.id,
                "loan_number": loan.loan_number,
                "hp_number": loan.hp_number,
                "customer_id": customer.id,
                "customer_name": customer.full_name,
                "transaction_type": txn.transaction_type,
                "payment_mode": txn.payment_mode,
                "cycle_number": cycle.cycle_number if cycle is not None else None,
                "collected_by": collector.username if collector is not None else None,
                "amount": _d(txn.amount),
                "ta_amount": _d(txn.ta_amount),
            }
        )

    payments_by_day: dict[date, list] = {}
    for loan, customer in disbursement_rows:
        payments_by_day.setdefault(loan.approval_date, []).append(
            {
                "loan_id": loan.id,
                "loan_number": loan.loan_number,
                "hp_number": loan.hp_number,
                "customer_id": customer.id,
                "customer_name": customer.full_name,
                "description": "Finance disbursement",
                "amount": _d(loan.principal),
            }
        )

    # Capital & expense entries — the non-loan side of the cash book.
    entries_in_by_day: dict[date, list] = {}
    entries_out_by_day: dict[date, list] = {}
    for e in cash_entries_in_range(db, date1, date2):
        bucket = entries_in_by_day if e.entry_type in CASH_IN_TYPES else entries_out_by_day
        bucket.setdefault(e.entry_date, []).append(
            {
                "entry_id": e.id,
                "entry_type": e.entry_type,
                "category": e.category,
                "notes": e.notes,
                "amount": _d(e.amount),
            }
        )

    opening = _cash_position_before(db, date1)

    days = []
    balance = opening
    mode_totals = {m.value.lower(): _ZERO for m in _BREAKDOWN_MODES}
    mode_totals["other"] = _ZERO
    grand = {
        "receipts": _ZERO,
        "payments": _ZERO,
        "emi": _ZERO,
        "ta": _ZERO,
        "down_payments": _ZERO,
        "capital_in": _ZERO,
        "other_income": _ZERO,
        "expenses": _ZERO,
        "capital_out": _ZERO,
    }

    active_days = (
        set(receipts_by_day)
        | set(payments_by_day)
        | set(entries_in_by_day)
        | set(entries_out_by_day)
    )
    for day in sorted(active_days):
        receipts = receipts_by_day.get(day, [])
        payments = payments_by_day.get(day, [])
        entries_in = entries_in_by_day.get(day, [])
        entries_out = entries_out_by_day.get(day, [])
        day_entries_in = sum((e["amount"] for e in entries_in), _ZERO)
        day_entries_out = sum((e["amount"] for e in entries_out), _ZERO)
        day_receipts = sum((r["amount"] for r in receipts), _ZERO) + day_entries_in
        day_payments = sum((p["amount"] for p in payments), _ZERO) + day_entries_out
        day_emi = sum(
            (
                r["amount"]
                for r in receipts
                if r["transaction_type"] == TransactionType.REGULAR
            ),
            _ZERO,
        )
        # TA (Travelling Allowance) — collected alongside EMIs, reported as its own
        # line like iFinance's "EMI TA"; kept OUT of receipts/emi/position totals.
        day_ta = sum((r["ta_amount"] for r in receipts), _ZERO)
        for r in receipts:
            mode = r["payment_mode"]
            key = mode.value.lower() if mode in _BREAKDOWN_MODES else "other"
            mode_totals[key] += r["amount"]
        for e in entries_in:
            key = "capital_in" if e["entry_type"] == CashEntryType.CAPITAL_IN else "other_income"
            grand[key] += e["amount"]
        for e in entries_out:
            key = "expenses" if e["entry_type"] == CashEntryType.EXPENSE else "capital_out"
            grand[key] += e["amount"]

        day_opening = balance
        balance = day_opening + day_receipts - day_payments
        grand["receipts"] += day_receipts
        grand["payments"] += day_payments
        grand["emi"] += day_emi
        grand["ta"] += day_ta
        grand["down_payments"] += day_receipts - day_entries_in - day_emi

        days.append(
            {
                "date": day,
                "opening_balance": day_opening,
                "closing_balance": balance,
                "total_receipts": day_receipts,
                "total_payments": day_payments,
                "emi_collection": day_emi,
                "ta_collection": day_ta,
                "down_payments": day_receipts - day_entries_in - day_emi,
                "receipts": receipts,
                "payments": payments,
                "entries_in": entries_in,
                "entries_out": entries_out,
            }
        )

    return {
        "date1": date1,
        "date2": date2,
        "opening_balance": opening,
        "closing_balance": balance,
        "total_receipts": grand["receipts"],
        "total_payments": grand["payments"],
        "total_emi_collection": grand["emi"],
        "total_ta_collection": grand["ta"],
        "total_down_payments": grand["down_payments"],
        "total_capital_in": grand["capital_in"],
        "total_other_income": grand["other_income"],
        "total_expenses": grand["expenses"],
        "total_capital_out": grand["capital_out"],
        "cash": mode_totals["cash"],
        "gpay": mode_totals["gpay"],
        "phonepe": mode_totals["phonepe"],
        "bank_transfer": mode_totals["bank_transfer"],
        "other": mode_totals["other"],
        "days": days,
    }


# --------------------------------------------------
# RECEIVED INTEREST (interest earned on collections in a window)
# --------------------------------------------------
def get_received_interest(db: Session, date1: date, date2: date) -> dict:
    """
    Per-loan interest earned on EMI collections inside [date1, date2].

    Loans are flat-rate here, so every collected rupee carries the same
    interest share: (total_payable − principal) / total_payable, with
    total_payable from the canonical schedule formula (finance.total_payable).
    received_interest = paid_in_window × that share, per loan.

    DOWN_PAYMENT transactions are excluded (origination cash, no interest
    component). Loans missing terms (unapproved drafts) report zero interest.
    """
    rows = (
        db.query(
            Loan.id,
            Loan.loan_number,
            Loan.hp_number,
            Loan.principal,
            Loan.interest_rate,
            Loan.tenure,
            Customer.id.label("customer_id"),
            Customer.full_name,
            func.coalesce(func.sum(Transaction.amount), 0).label("paid"),
            func.count(Transaction.id).label("txn_count"),
        )
        .join(Transaction, Transaction.loan_id == Loan.id)
        .join(Customer, Customer.id == Loan.customer_id)
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.REGULAR,
            Transaction.is_deleted == False,
            Loan.is_deleted == False,
            Transaction.effective_payment_date >= date1,
            Transaction.effective_payment_date <= date2,
        )
        .group_by(Loan.id, Customer.id)
        .order_by(Customer.full_name.asc(), Loan.id.asc())
        .all()
    )

    two_places = Decimal("0.01")
    results = []
    total_paid = _ZERO
    total_interest = _ZERO
    for r in rows:
        paid = _d(r.paid)
        interest = _ZERO
        if r.principal and r.interest_rate is not None and r.tenure:
            tp = calc_total_payable(_d(r.principal), _d(r.interest_rate), r.tenure)
            if tp > 0:
                interest = (paid * (tp - _d(r.principal)) / tp).quantize(two_places)
        total_paid += paid
        total_interest += interest
        results.append(
            {
                "loan_id": r.id,
                "loan_number": r.loan_number,
                "hp_number": r.hp_number,
                "customer_id": r.customer_id,
                "customer_name": r.full_name,
                "amount_paid": paid,
                "received_interest": interest,
                "transaction_count": r.txn_count,
            }
        )

    return {
        "date1": date1,
        "date2": date2,
        "total_amount_paid": total_paid,
        "total_received_interest": total_interest,
        "results": results,
    }


# --------------------------------------------------
# HP OUTSTANDING / HP RECEIVABLE (as-of-now open-loan ledger)
# --------------------------------------------------
def _open_loan_ledger_rows(
    db: Session,
    statuses=OPEN_LOAN_STATUSES,
    date1: Optional[date] = None,
    date2: Optional[date] = None,
):
    """
    One row per loan in `statuses` with its due-cycle ledger totals:
    (Loan, Customer, payable, collected, outstanding).

    Same source of truth as the dashboard/portfolio numbers: due_cycles over
    OPEN_LOAN_STATUSES by default, outstanding floored at 0 per cycle. The
    balance sheet passes (LoanStatus.BAD_DEBT,) to size write-offs.

    `date1`/`date2` narrow the loan set by approval date — the cohort of
    finances written in that window. The ledger figures stay current: this
    answers "of the loans we wrote then, what is owed now", NOT "what was owed
    on that date". A true point-in-time position is not derivable — closure
    dates are not recorded anywhere (loan_closures is empty), so loans closed
    since a past date cannot be identified. The balance sheet therefore takes
    no date window at all.
    """
    cycle_sub = (
        db.query(
            DueCycle.loan_id.label("loan_id"),
            func.coalesce(func.sum(DueCycle.total_due), 0).label("payable"),
            func.coalesce(func.sum(DueCycle.total_received), 0).label("collected"),
            # Net per loan (prepayments offset later shortfalls), not per-cycle
            # floored — see _loan_net_outstanding.
            _loan_net_outstanding().label("outstanding"),
        )
        .filter(DueCycle.is_deleted == False)
        .group_by(DueCycle.loan_id)
        .subquery()
    )

    q = (
        db.query(
            Loan,
            Customer,
            func.coalesce(cycle_sub.c.payable, 0).label("payable"),
            func.coalesce(cycle_sub.c.collected, 0).label("collected"),
            func.coalesce(cycle_sub.c.outstanding, 0).label("outstanding"),
        )
        .join(Customer, Customer.id == Loan.customer_id)
        .outerjoin(cycle_sub, cycle_sub.c.loan_id == Loan.id)
        .filter(
            Loan.is_deleted == False,
            Loan.status.in_(statuses),
        )
    )
    if date1 is not None:
        q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date >= date1)
    if date2 is not None:
        q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date <= date2)

    return q.order_by(Customer.full_name.asc(), Loan.id.asc()).all()


def get_hp_outstanding(
    db: Session, date1: Optional[date] = None, date2: Optional[date] = None
) -> dict:
    """
    Per open loan: principal, payable, collected, outstanding — plus totals.

    `date1`/`date2` scope to loans approved in that window; figures remain
    current. See _open_loan_ledger_rows for why this is a cohort filter rather
    than a point-in-time position.
    """
    results = []
    customer_ids = set()
    totals = {"principal": _ZERO, "payable": _ZERO, "collected": _ZERO, "outstanding": _ZERO}
    for loan, customer, payable, collected, outstanding in _open_loan_ledger_rows(
        db, date1=date1, date2=date2
    ):
        customer_ids.add(customer.id)
        principal = _d(loan.principal)
        payable_d, collected_d, outstanding_d = _d(payable), _d(collected), _d(outstanding)
        totals["principal"] += principal
        totals["payable"] += payable_d
        totals["collected"] += collected_d
        totals["outstanding"] += outstanding_d
        results.append(
            {
                "loan_id": loan.id,
                "loan_number": loan.loan_number,
                "hp_number": loan.hp_number,
                "customer_id": customer.id,
                "customer_name": customer.full_name,
                "branch_point": customer.branch_point,
                "status": loan.status,
                "principal": principal,
                "payable": payable_d,
                "collected": collected_d,
                "outstanding": outstanding_d,
            }
        )

    return {
        "total_loans": len(results),
        "total_customers": len(customer_ids),
        "total_principal": totals["principal"],
        "total_payable": totals["payable"],
        "total_collected": totals["collected"],
        "total_outstanding": totals["outstanding"],
        "results": results,
    }


def get_hp_receivable(
    db: Session, date1: Optional[date] = None, date2: Optional[date] = None
) -> dict:
    """
    Per open loan: interest still to be earned = outstanding × the loan's
    flat-rate interest share (total_payable − principal) / total_payable —
    the receivable-side mirror of get_received_interest.

    `date1`/`date2` scope to loans approved in that window.
    """
    two_places = Decimal("0.01")
    results = []
    customer_ids = set()
    total_outstanding = _ZERO
    total_receivable = _ZERO
    for loan, customer, _payable, _collected, outstanding in _open_loan_ledger_rows(
        db, date1=date1, date2=date2
    ):
        customer_ids.add(customer.id)
        outstanding_d = _d(outstanding)
        receivable = _ZERO
        if loan.principal and loan.interest_rate is not None and loan.tenure:
            tp = calc_total_payable(_d(loan.principal), _d(loan.interest_rate), loan.tenure)
            if tp > 0:
                receivable = (
                    outstanding_d * (tp - _d(loan.principal)) / tp
                ).quantize(two_places)
        total_outstanding += outstanding_d
        total_receivable += receivable
        results.append(
            {
                "loan_id": loan.id,
                "loan_number": loan.loan_number,
                "hp_number": loan.hp_number,
                "customer_id": customer.id,
                "customer_name": customer.full_name,
                "outstanding": outstanding_d,
                "receivable_interest": receivable,
            }
        )

    return {
        "total_loans": len(results),
        "total_customers": len(customer_ids),
        "total_outstanding": total_outstanding,
        "total_receivable_interest": total_receivable,
        "results": results,
    }


# --------------------------------------------------
# HP REGISTER (all executed finances)
# --------------------------------------------------
def get_hp_register(
    db: Session, date1: Optional[date] = None, date2: Optional[date] = None
) -> dict:
    """
    The register of executed finances: every non-deleted, non-DRAFT loan with
    its terms, vehicle, and dates. DRAFTs are excluded — a register records
    agreements, not applications in progress.

    `date1`/`date2` bound the approval date; omitting both is all-time. Loans
    with no approval_date are dropped once a bound is given — an agreement with
    no execution date cannot be placed in a window.
    """
    q = (
        db.query(Loan, Customer, Vehicle)
        .join(Customer, Customer.id == Loan.customer_id)
        .outerjoin(Vehicle, Vehicle.id == Loan.vehicle_id)
        .filter(
            Loan.is_deleted == False,
            Loan.status != LoanStatus.DRAFT,
        )
    )
    if date1 is not None:
        q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date >= date1)
    if date2 is not None:
        q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date <= date2)
    rows = q.order_by(
        Loan.approval_date.asc().nulls_last(), Loan.created_at.asc()
    ).all()

    results = []
    customer_ids = set()
    total_principal = _ZERO
    total_payable_sum = _ZERO
    for loan, customer, vehicle in rows:
        customer_ids.add(customer.id)
        principal = _d(loan.principal)
        tp = _ZERO
        if loan.principal and loan.interest_rate is not None and loan.tenure:
            tp = calc_total_payable(_d(loan.principal), _d(loan.interest_rate), loan.tenure)
        total_principal += principal
        total_payable_sum += tp
        results.append(
            {
                "loan_id": loan.id,
                "loan_number": loan.loan_number,
                "hp_number": loan.hp_number,
                "customer_id": customer.id,
                "customer_name": customer.full_name,
                "customer_mobile": customer.mobile_number,
                "vehicle_plate": vehicle.plate_number if vehicle is not None else None,
                "approval_date": loan.approval_date,
                "principal": principal,
                "interest_rate": _d(loan.interest_rate) if loan.interest_rate is not None else None,
                "tenure": loan.tenure,
                "total_payable": tp,
                "status": loan.status,
            }
        )

    return {
        "total_loans": len(results),
        "total_customers": len(customer_ids),
        "total_principal": total_principal,
        "total_payable": total_payable_sum,
        "results": results,
    }


# --------------------------------------------------
# FEES COLLECTED
# --------------------------------------------------
def get_vehicle_register(
    db: Session, date1: Optional[date] = None, date2: Optional[date] = None
) -> dict:
    """
    The collateral & inventory register: every non-deleted vehicle with its
    valuation (market value, purchase cost) and, for a pledged vehicle, the
    finance it backs (latest linked loan's HP number + customer).

    `date1`/`date2` bound the registration date (created_at) inclusively;
    omitting both is all-time. Totals and a per-status count summarise the
    selected set. Unlike the loan reports there is no DRAFT concept here — a
    vehicle is inventory the moment it is registered.
    """
    q = db.query(Vehicle).filter(Vehicle.is_deleted == False)  # noqa: E712
    if date1 is not None:
        q = q.filter(Vehicle.created_at >= datetime.combine(date1, time.min))
    if date2 is not None:
        q = q.filter(
            Vehicle.created_at < datetime.combine(date2 + timedelta(days=1), time.min)
        )
    vehicles = q.order_by(Vehicle.created_at.desc(), Vehicle.id.asc()).all()

    # Latest linked loan per vehicle (one grouped query, not a join, so a
    # vehicle backing several loans never multiplies its register row). Newest
    # loan wins — that is the finance the vehicle is currently pledged against.
    loan_by_vehicle: dict = {}
    vehicle_ids = [v.id for v in vehicles]
    if vehicle_ids:
        loan_rows = (
            db.query(Loan, Customer)
            .join(Customer, Customer.id == Loan.customer_id)
            .filter(
                Loan.vehicle_id.in_(vehicle_ids),
                Loan.is_deleted == False,  # noqa: E712
            )
            .order_by(Loan.created_at.desc())
            .all()
        )
        for loan, customer in loan_rows:
            # First seen wins because the query is newest-first.
            loan_by_vehicle.setdefault(
                loan.vehicle_id, (loan, customer.full_name)
            )

    results = []
    total_market = _ZERO
    total_cost = _ZERO
    status_counts = {s.value: 0 for s in AssetStatus}
    for v in vehicles:
        market = _d(v.market_value)
        cost = _d(v.purchase_cost)
        total_market += market
        total_cost += cost
        status_counts[v.status.value] = status_counts.get(v.status.value, 0) + 1
        linked = loan_by_vehicle.get(v.id)
        results.append(
            {
                "vehicle_id": v.id,
                "plate_number": v.plate_number,
                "make": v.make,
                "model": v.model,
                "year": v.year,
                "type": v.type.value,
                "status": v.status.value,
                "market_value": market,
                "purchase_cost": cost,
                "hp_number": linked[0].hp_number if linked else None,
                "loan_id": linked[0].id if linked else None,
                "customer_name": linked[1] if linked else None,
            }
        )

    return {
        "total_vehicles": len(vehicles),
        "total_market_value": total_market,
        "total_purchase_cost": total_cost,
        "status_counts": status_counts,
        "results": results,
    }


def get_fee_report(
    db: Session, date1: Optional[date] = None, date2: Optional[date] = None
) -> dict:
    """
    The four one-off charges recorded on each executed finance — processing,
    documentation, DSC, and RTO — per loan and in total.

    These are agreed at the financials step and stored on `loans`, so this
    reports what was CHARGED on the agreement, not what has been received in
    cash. There is no per-fee receipt anywhere in the schema to reconcile
    against.

    Windowing and the DRAFT exclusion match `get_hp_register`: `date1`/`date2`
    bound the approval date, omitting both is all-time, and a loan with no
    approval date drops out once either bound is given.
    """
    q = (
        db.query(Loan, Customer)
        .join(Customer, Customer.id == Loan.customer_id)
        .filter(
            Loan.is_deleted == False,  # noqa: E712
            Loan.status != LoanStatus.DRAFT,
        )
    )
    if date1 is not None:
        q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date >= date1)
    if date2 is not None:
        q = q.filter(Loan.approval_date.isnot(None), Loan.approval_date <= date2)
    rows = q.order_by(
        Loan.approval_date.asc().nulls_last(), Loan.created_at.asc()
    ).all()

    # Penalty charged per loan (Σ DueCycle.penalty_amount) for the loans shown —
    # one grouped query, matched to the row's loan_id.
    loan_ids = [loan.id for loan, _customer in rows]
    penalty_map: dict = {}
    if loan_ids:
        for loan_id, total in (
            db.query(DueCycle.loan_id, func.coalesce(func.sum(DueCycle.penalty_amount), 0))
            .filter(DueCycle.loan_id.in_(loan_ids), DueCycle.is_deleted == False)
            .group_by(DueCycle.loan_id)
            .all()
        ):
            penalty_map[loan_id] = _d(total)

    results = []
    customer_ids = set()
    totals = {
        "processing": _ZERO,
        "documentation": _ZERO,
        "dsc": _ZERO,
        "rto": _ZERO,
        "penalty": _ZERO,
    }
    for loan, customer in rows:
        customer_ids.add(customer.id)
        processing = _d(loan.processing_fee)
        documentation = _d(loan.documentation_fee)
        dsc = _d(loan.dsc_fee)
        rto = _d(loan.rto_fee)
        penalty = penalty_map.get(loan.id, _ZERO)
        totals["processing"] += processing
        totals["documentation"] += documentation
        totals["dsc"] += dsc
        totals["rto"] += rto
        totals["penalty"] += penalty
        results.append(
            {
                "loan_id": loan.id,
                "loan_number": loan.loan_number,
                "hp_number": loan.hp_number,
                "customer_id": customer.id,
                "customer_name": customer.full_name,
                "customer_mobile": customer.mobile_number,
                "approval_date": loan.approval_date,
                "status": loan.status,
                "processing_fee": processing,
                "documentation_fee": documentation,
                "dsc_fee": dsc,
                "rto_fee": rto,
                "total_fee": processing + documentation + dsc + rto,
                "penalty_charged": penalty,
            }
        )

    return {
        "total_loans": len(results),
        "total_customers": len(customer_ids),
        "total_processing_fee": totals["processing"],
        "total_documentation_fee": totals["documentation"],
        "total_dsc_fee": totals["dsc"],
        "total_rto_fee": totals["rto"],
        "total_fees": totals["processing"] + totals["documentation"] + totals["dsc"] + totals["rto"],
        "total_penalties": totals["penalty"],
        "results": results,
    }


# --------------------------------------------------
# PROFIT & LOSS / BALANCE SHEET
# --------------------------------------------------
def _interest_received_total(
    db: Session, date1: Optional[date] = None, date2: Optional[date] = None
) -> tuple[Decimal, Decimal]:
    """
    (total_paid, total_interest) over REGULAR SUCCESS collections, applying
    each loan's flat-rate interest share — the aggregate twin of
    get_received_interest (which returns the per-loan rows).
    """
    q = (
        db.query(
            Loan.principal,
            Loan.interest_rate,
            Loan.tenure,
            func.coalesce(func.sum(Transaction.amount), 0).label("paid"),
        )
        .join(Transaction, Transaction.loan_id == Loan.id)
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.REGULAR,
            Transaction.is_deleted == False,
            Loan.is_deleted == False,
        )
    )
    if date1 is not None:
        q = q.filter(Transaction.effective_payment_date >= date1)
    if date2 is not None:
        q = q.filter(Transaction.effective_payment_date <= date2)
    rows = q.group_by(Loan.id).all()

    two_places = Decimal("0.01")
    total_paid = _ZERO
    total_interest = _ZERO
    for r in rows:
        paid = _d(r.paid)
        total_paid += paid
        if r.principal and r.interest_rate is not None and r.tenure:
            tp = calc_total_payable(_d(r.principal), _d(r.interest_rate), r.tenure)
            if tp > 0:
                total_interest += (paid * (tp - _d(r.principal)) / tp).quantize(two_places)
    return total_paid, total_interest


def get_pnl(db: Session, date1: date, date2: date) -> dict:
    """
    Profit & Loss for [date1, date2].

    Income = interest earned on the window's EMI collections (flat-rate share,
    same rule as Received Interest) + OTHER_INCOME cash entries + fee income +
    penalty income. Expenses = EXPENSE cash entries, broken down by category.
    Capital movements and down payments are balance-sheet items, not P&L;
    bad-debt write-offs carry no event date, so they too surface only on the
    balance sheet.

    Fee and penalty income are windowed by loan APPROVAL date (the cohort of
    finances written in the window) — fees/penalties have no per-payment event
    date to bucket on. The frontend toggles let a viewer exclude either line to
    get the pure interest-on-collections view.
    """
    collections, interest_received = _interest_received_total(db, date1, date2)
    sums = cash_entry_type_sums(db, date1, date2)
    other_income = sums.get(CashEntryType.OTHER_INCOME, _ZERO)
    fee_income = _fee_income_total(db, date1, date2)
    penalty_income = _penalty_income_total(db, date1, date2)
    expenses = sums.get(CashEntryType.EXPENSE, _ZERO)
    # TA (Travelling Allowance) collected on EMIs is real income, separate from
    # the interest share — bucket on the same effective_payment_date window.
    ta_income = _d(
        db.query(func.coalesce(func.sum(Transaction.ta_amount), 0))
        .join(Loan, Loan.id == Transaction.loan_id)
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.REGULAR,
            Transaction.is_deleted == False,
            Loan.is_deleted == False,
            Transaction.effective_payment_date >= date1,
            Transaction.effective_payment_date <= date2,
        )
        .scalar()
    )
    total_income = interest_received + ta_income + other_income + fee_income + penalty_income
    return {
        "date1": date1,
        "date2": date2,
        "collections": collections,
        "interest_received": interest_received,
        "ta_income": ta_income,
        "other_income": other_income,
        "fee_income": fee_income,
        "penalty_income": penalty_income,
        "total_income": total_income,
        "total_expenses": expenses,
        "expenses_by_category": [
            {"category": category, "amount": amount}
            for category, amount in expense_category_sums(db, date1, date2)
        ],
        "net_profit": total_income - expenses,
    }


def get_balance_sheet(db: Session) -> dict:
    """
    Balance sheet as of today (all history).

    Assets = cash in hand (the day report's closing position) + HP outstanding,
    split into principal receivable and unearned interest by each loan's
    flat-rate share. Funded by = net capital + retained earnings (interest
    earned + other income − expenses − bad-debt principal written off) + down
    payments received + that same unearned interest. Under flat-share
    accounting the two sides agree exactly; `difference` surfaces whatever
    per-transaction rounding or data quirks remain instead of hiding them.
    """
    two_places = Decimal("0.01")
    today = _today()
    cash_position = _cash_position_before(db, today + timedelta(days=1))

    # Penalty charged per open loan — carved OUT of the receivable before the
    # flat principal/interest split so a late-payment penalty is not mis-labelled
    # as principal + interest (that mis-split was the last balance-sheet residual).
    penalty_by_loan = _penalty_charged_by_loan(db, statuses=OPEN_LOAN_STATUSES)

    def _split(rows, penalty_map):
        """(outstanding_total, interest_portion, penalty_out) for ledger rows.
        The penalty portion still owed (min of the loan's net outstanding and its
        penalty charged) is carved off and returned separately; only the
        remaining principal+interest is flat-split by the loan's flat-rate share."""
        outstanding_total = _ZERO
        interest_portion = _ZERO
        penalty_out_total = _ZERO
        for loan, _customer, _payable, _collected, outstanding in rows:
            outstanding_d = _d(outstanding)
            outstanding_total += outstanding_d
            pen_out = min(outstanding_d, penalty_map.get(loan.id, _ZERO))
            penalty_out_total += pen_out
            non_penalty = outstanding_d - pen_out
            if loan.principal and loan.interest_rate is not None and loan.tenure:
                tp = calc_total_payable(_d(loan.principal), _d(loan.interest_rate), loan.tenure)
                if tp > 0:
                    interest_portion += (
                        non_penalty * (tp - _d(loan.principal)) / tp
                    ).quantize(two_places)
        return outstanding_total, interest_portion, penalty_out_total

    open_rows = _open_loan_ledger_rows(db)
    receivable_total, unearned_interest, penalty_receivable = _split(open_rows, penalty_by_loan)
    # Three-way asset split: principal + unearned interest + outstanding penalty.
    receivable_principal = receivable_total - unearned_interest - penalty_receivable

    # Write-offs: BAD_DEBT loans keep their unpaid cycles; the principal share
    # is a realised loss, the interest share simply never materialises. Their
    # penalty is not recognised as income (recognition is open-loans-only), so it
    # is carved off here too and simply not written off as principal.
    bad_penalty_by_loan = _penalty_charged_by_loan(db, statuses=(LoanStatus.BAD_DEBT,))
    bad_total, bad_interest, _bad_penalty = _split(
        _open_loan_ledger_rows(db, statuses=(LoanStatus.BAD_DEBT,)), bad_penalty_by_loan
    )
    bad_debt_written_off = bad_total - bad_interest - _bad_penalty

    _, interest_earned = _interest_received_total(db)
    # Fee income: the four one-off charges, recognised at disbursement. They are
    # retained cash (principal is booked out gross while the customer receives
    # principal − fees), so they are added to BOTH cash-in-hand (asset) and
    # retained earnings (funding) — the two move together, keeping the sheet
    # balanced while making cash and profit accurate. Penalty income: penalty
    # charged on open loans (already inside the receivable via total_due).
    fee_income = _fee_income_total(db)
    penalty_income = _penalty_income_total(db)
    cash_in_hand = cash_position + fee_income

    sums = cash_entry_type_sums(db)
    capital_in = sums.get(CashEntryType.CAPITAL_IN, _ZERO)
    capital_out = sums.get(CashEntryType.CAPITAL_OUT, _ZERO)
    other_income = sums.get(CashEntryType.OTHER_INCOME, _ZERO)
    expenses = sums.get(CashEntryType.EXPENSE, _ZERO)

    down_payments = _d(
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .join(Loan, Loan.id == Transaction.loan_id)
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.DOWN_PAYMENT,
            Transaction.is_deleted == False,
            Loan.is_deleted == False,
        )
        .scalar()
    )

    retained_earnings = (
        interest_earned
        + other_income
        + fee_income
        + penalty_income
        - expenses
        - bad_debt_written_off
    )
    total_assets = cash_in_hand + receivable_total
    total_funded = (
        (capital_in - capital_out) + retained_earnings + down_payments + unearned_interest
    )
    return {
        "as_of": today,
        "cash_in_hand": cash_in_hand,
        "receivable_principal": receivable_principal,
        "unearned_interest": unearned_interest,
        "penalty_receivable": penalty_receivable,
        "receivable_total": receivable_total,
        "total_assets": total_assets,
        "open_loans": len(open_rows),
        "capital_in": capital_in,
        "capital_out": capital_out,
        "capital_net": capital_in - capital_out,
        "interest_earned": interest_earned,
        "other_income": other_income,
        "fee_income": fee_income,
        "penalty_income": penalty_income,
        "expenses": expenses,
        "bad_debt_written_off": bad_debt_written_off,
        "retained_earnings": retained_earnings,
        "down_payments_received": down_payments,
        "total_funded": total_funded,
        "difference": total_assets - total_funded,
    }
