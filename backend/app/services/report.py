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
from decimal import Decimal
from datetime import date, timedelta
from typing import Iterable

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
from app.models.user import User
from app.models.vehicle import Vehicle


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


def _month_axis(months: Iterable[str]) -> list[str]:
    """
    Given an iterable of 'YYYY-MM' strings from multiple series, return a
    contiguous, sorted month axis covering [min, max]. When the iterable is
    empty, return the last 12 months ending at the current month so an
    empty-DB dashboard still renders a meaningful chart.
    """
    months = sorted({m for m in months if m})

    today = date.today()

    if not months:
        end_year, end_month = today.year, today.month
        start_year, start_month = end_year, end_month - 11
        while start_month < 1:
            start_month += 12
            start_year -= 1
    else:
        start_year, start_month = (int(p) for p in months[0].split("-"))
        end_year, end_month = (int(p) for p in months[-1].split("-"))
        # Always extend to "now" so the latest months aren't truncated
        # when there happens to be no activity in them yet.
        if (end_year, end_month) < (today.year, today.month):
            end_year, end_month = today.year, today.month

    out: list[str] = []
    y, m = start_year, start_month
    while (y, m) <= (end_year, end_month):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def _zero_fill(series: dict[str, Decimal | int], axis: list[str], zero):
    """Project a {month: value} dict onto a fixed axis, filling gaps with zero."""
    return [{"month": m, **{"value": series.get(m, zero)}} for m in axis]


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
    # Outstanding   = SUM(total_due - total_received), floored at 0 per cycle.
    cycle_totals = (
        db.query(
            func.coalesce(
                func.sum(
                    case(
                        (
                            DueCycle.total_due > DueCycle.total_received,
                            DueCycle.total_due - DueCycle.total_received,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("outstanding"),
        )
        .join(Loan, Loan.id == DueCycle.loan_id)
        .filter(
            DueCycle.is_deleted == False,
            Loan.is_deleted == False,
            Loan.status.in_(OPEN_LOAN_STATUSES),
        )
        .first()
    )

    total_outstanding = _d(cycle_totals.outstanding if cycle_totals else 0)

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
    cycle_totals = (
        db.query(
            func.coalesce(func.sum(DueCycle.total_due), 0).label("payable"),
            func.coalesce(func.sum(DueCycle.total_received), 0).label("collected"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            DueCycle.total_due > DueCycle.total_received,
                            DueCycle.total_due - DueCycle.total_received,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("outstanding"),
        )
        .join(Loan, Loan.id == DueCycle.loan_id)
        .filter(
            DueCycle.is_deleted == False,
            Loan.is_deleted == False,
            Loan.status.in_(OPEN_LOAN_STATUSES),
        )
        .first()
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
        "total_outstanding": _d(cycle_totals.outstanding if cycle_totals else 0),
        "average_interest_rate": Decimal(str(avg_rate)).quantize(Decimal("0.01")),
        "average_tenure": Decimal(str(avg_tenure)).quantize(Decimal("0.1")),
    }


# --------------------------------------------------
# COLLECTIONS REPORT
# --------------------------------------------------
def get_collection_report(db: Session, period: str = "daily", days: int = 30) -> dict:
    """
    Collection report grouped by day or month.

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

    since = date.today() - timedelta(days=days)

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

    results = (
        db.query(
            date_group.label("date"),
            func.count(Transaction.id).label("count"),
            func.coalesce(func.sum(Transaction.amount), 0).label("total"),
            _mode_sum(PaymentMethod.CASH).label("cash"),
            _mode_sum(PaymentMethod.GPAY).label("gpay"),
            _mode_sum(PaymentMethod.PHONEPE).label("phonepe"),
            _mode_sum(PaymentMethod.BANK_TRANSFER).label("bank_transfer"),
            other_sum.label("other"),
        )
        .filter(
            Transaction.is_deleted == False,
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.REGULAR,
            Transaction.effective_payment_date >= since,
        )
        .group_by(date_group)
        .order_by(date_group.desc())
        .all()
    )

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
def get_customer_report(db: Session) -> dict:
    """
    Per-customer roll-up.

    Outstanding is sourced from due_cycles (the canonical ledger) for loans
    in OPEN_LOAN_STATUSES. "Active loans" counts loans in those same
    open statuses. "Paid" counts SUCCESS REGULAR transactions on those loans.
    """

    loan_sub = (
        db.query(
            Loan.customer_id,
            func.count(Loan.id).label("active_loans"),
            func.coalesce(func.sum(Loan.principal), 0).label("principal"),
        )
        .filter(Loan.status.in_(OPEN_LOAN_STATUSES), Loan.is_deleted == False)
        .group_by(Loan.customer_id)
        .subquery()
    )

    paid_sub = (
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
        .group_by(Loan.customer_id)
        .subquery()
    )

    outstanding_sub = (
        db.query(
            Loan.customer_id,
            func.coalesce(
                func.sum(
                    case(
                        (
                            DueCycle.total_due > DueCycle.total_received,
                            DueCycle.total_due - DueCycle.total_received,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("outstanding"),
        )
        .join(DueCycle, DueCycle.loan_id == Loan.id)
        .filter(
            Loan.status.in_(OPEN_LOAN_STATUSES),
            Loan.is_deleted == False,
            DueCycle.is_deleted == False,
        )
        .group_by(Loan.customer_id)
        .subquery()
    )

    rows = (
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
        .order_by(outstanding_sub.c.outstanding.desc().nullslast())
        .all()
    )

    results = [
        {
            "customer_id": str(r.id),
            "customer_name": r.full_name,
            "mobile_number": r.mobile_number,
            "active_loans": r.active_loans,
            "total_principal": _d(r.principal),
            "total_paid": _d(r.paid),
            "total_outstanding": _d(r.outstanding),
        }
        for r in rows
    ]

    return {
        "total_customers": len(results),
        "customers_with_active_loans": sum(
            1 for x in results if x["active_loans"] > 0
        ),
        "results": results,
    }


# --------------------------------------------------
# EMPLOYEE PERFORMANCE
# --------------------------------------------------
def get_employee_report(db: Session) -> dict:

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

    # Only REGULAR collections count toward employee performance;
    # DOWN_PAYMENT cash handed at disbursal isn't a "collection".
    collections_sub = (
        db.query(
            Transaction.collected_by_id.label("emp_id"),
            func.coalesce(func.sum(Transaction.amount), 0).label("total_amount"),
            func.count(Transaction.id).label("txn_count"),
        )
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.REGULAR,
            Transaction.is_deleted == False,
            Transaction.collected_by_id.isnot(None),
        )
        .group_by(Transaction.collected_by_id)
        .subquery()
    )

    rows = (
        db.query(
            User.id,
            User.username,
            User.role,
            func.coalesce(assigned_sub.c.cnt, 0).label("assigned_customers"),
            func.coalesce(collections_sub.c.total_amount, 0).label("total_collections"),
            func.coalesce(collections_sub.c.txn_count, 0).label("transaction_count"),
        )
        .outerjoin(assigned_sub, assigned_sub.c.emp_id == User.id)
        .outerjoin(collections_sub, collections_sub.c.emp_id == User.id)
        .filter(User.is_deleted == False, User.is_active == True)
        .all()
    )

    results = [
        {
            "employee_id": str(r.id),
            "employee_name": r.username,
            "role": r.role.value,
            "assigned_customers": r.assigned_customers,
            "total_collections": _d(r.total_collections),
            "transaction_count": r.transaction_count,
        }
        for r in rows
    ]
    results.sort(key=lambda x: x["total_collections"], reverse=True)

    return {"results": results}


# --------------------------------------------------
# Charts
# --------------------------------------------------
def get_collection_chart(db: Session) -> list:
    """
    Monthly REGULAR collection totals — buckets on effective_payment_date.

    Months with no activity are zero-filled across [earliest data month,
    current month] so the frontend renders a continuous series.
    """

    month = func.to_char(Transaction.effective_payment_date, "YYYY-MM")

    rows = (
        db.query(
            month.label("month"),
            func.coalesce(func.sum(Transaction.amount), 0).label("amount"),
        )
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.transaction_type == TransactionType.REGULAR,
            Transaction.is_deleted == False,
        )
        .group_by(month)
        .order_by(month)
        .all()
    )

    series = {r.month: _d(r.amount) for r in rows}
    axis = _month_axis(series.keys())
    return [{"month": m, "amount": series.get(m, _ZERO)} for m in axis]


# --------------------------------------------------
# Trends
# --------------------------------------------------
def get_monthly_trends(db: Session) -> dict:
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
    """

    cust_month_col = _local_month(Customer.created_at)
    customers_raw = (
        db.query(
            cust_month_col.label("month"),
            func.count(Customer.id).label("count"),
        )
        .filter(Customer.is_deleted == False)
        .group_by(cust_month_col)
        .all()
    )

    loan_month_col = _local_month(Loan.created_at)
    loans_raw = (
        db.query(
            loan_month_col.label("month"),
            func.count(Loan.id).label("count"),
        )
        .filter(Loan.is_deleted == False)
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
        )
        .group_by(coll_month_col)
        .all()
    )

    customers_map = {r.month: r.count for r in customers_raw}
    loans_map = {r.month: r.count for r in loans_raw}
    collections_map = {r.month: _d(r.amount) for r in collections_raw}

    axis = _month_axis(
        list(customers_map.keys())
        + list(loans_map.keys())
        + list(collections_map.keys())
    )

    return {
        "new_customers": [
            {"month": m, "count": customers_map.get(m, 0)} for m in axis
        ],
        "new_loans": [
            {"month": m, "count": loans_map.get(m, 0)} for m in axis
        ],
        "collections": [
            {"month": m, "amount": collections_map.get(m, _ZERO)} for m in axis
        ],
    }
