from decimal import Decimal
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, case, and_
from sqlalchemy.orm import Session

from app.models.customer import Customer
from app.models.document import Document
from app.models.loan import Loan, LoanStatus
from app.models.transaction import Transaction, TransactionStatus, PaymentMethod
from app.models.user import User
from app.models.vehicle import Vehicle


# --------------------------------------------------
# DASHBOARD SUMMARY
# --------------------------------------------------
def get_dashboard_summary(db: Session) -> dict:
    """High level overview for admin dashboard"""

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

    # Active loan principal (what has been lent and is still open)
    active_principal = (
        db.query(func.coalesce(func.sum(Loan.principal), 0))
        .filter(Loan.is_deleted == False, Loan.status == LoanStatus.ACTIVE)
        .scalar()
    ) or Decimal("0")

    # Collections against active loans only
    total_collected = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .join(Loan, Loan.id == Transaction.loan_id)
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted == False,
            Loan.status == LoanStatus.ACTIVE,
            Loan.is_deleted == False,
        )
        .scalar()
    )

    total_pending = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.is_deleted == False,
            Transaction.status == TransactionStatus.PENDING,
        )
        .scalar()
    )

    return {
        "total_customers": total_customers,
        "total_active_loans": status_counts.get(LoanStatus.ACTIVE, 0),
        "total_closed_loans": status_counts.get(LoanStatus.CLOSED, 0),
        "total_bad_debt_loans": status_counts.get(LoanStatus.BAD_DEBT, 0),
        "total_vehicles": total_vehicles,
        "total_documents": total_documents,
        "total_principal_outstanding": active_principal - Decimal(str(total_collected)),
        "total_amount_collected": Decimal(str(total_collected)),
        "total_pending_collections": Decimal(str(total_pending)),
    }


# --------------------------------------------------
# LOAN PORTFOLIO
# --------------------------------------------------
def get_loan_portfolio(db: Session) -> dict:

    stats = (
        db.query(
            func.count(Loan.id),
            func.sum(Loan.principal),
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

    # Active loan principal (still open)
    active_principal = (
        db.query(func.coalesce(func.sum(Loan.principal), 0))
        .filter(Loan.status == LoanStatus.ACTIVE, Loan.is_deleted == False)
        .scalar()
    ) or Decimal("0")

    # Collections against ACTIVE loans only — makes outstanding meaningful
    total_collected = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .join(Loan, Loan.id == Transaction.loan_id)
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted == False,
            Loan.status == LoanStatus.ACTIVE,
            Loan.is_deleted == False,
        )
        .scalar()
    )

    total_loans = stats[0] or 0
    total_principal = stats[1] or Decimal("0")

    return {
        "total_loans": total_loans,
        "active_loans": status_counts.get(LoanStatus.ACTIVE, 0),
        "closed_loans": status_counts.get(LoanStatus.CLOSED, 0),
        "bad_debt_loans": status_counts.get(LoanStatus.BAD_DEBT, 0),
        "total_principal": total_principal,
        "total_payable": active_principal,
        "total_collected": Decimal(str(total_collected)),
        "total_outstanding": active_principal - Decimal(str(total_collected)),
        "average_interest_rate": round(stats[2] or 0, 2),
        "average_tenure": round(stats[3] or 0, 1),
    }


# --------------------------------------------------
# COLLECTIONS REPORT
# --------------------------------------------------
def get_collection_report(db: Session, period: str = "daily", days: int = 30) -> dict:
    """Collection report grouped by day or month"""

    since = datetime.now(timezone.utc) - timedelta(days=days)

    if period == "daily":
        date_group = func.date(Transaction.created_at)
    else:
        date_group = func.to_char(Transaction.created_at, "YYYY-MM")

    # Get totals per date per payment method
    results = (
        db.query(
            date_group.label("date"),
            func.count(Transaction.id).label("count"),
            func.coalesce(func.sum(Transaction.amount), 0).label("total"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            Transaction.payment_mode == PaymentMethod.CASH,
                            Transaction.amount,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("cash"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            Transaction.payment_mode == PaymentMethod.GPAY,
                            Transaction.amount,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("gpay"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            Transaction.payment_mode == PaymentMethod.PHONEPE,
                            Transaction.amount,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("phonepe"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            Transaction.payment_mode == PaymentMethod.BANK_TRANSFER,
                            Transaction.amount,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("bank_transfer"),
        )
        .filter(
            Transaction.is_deleted == False,
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.created_at >= since,
        )
        .group_by(date_group)
        .order_by(date_group.desc())
        .all()
    )

    entries = [
        {
            "date": str(r.date),
            "total_amount": Decimal(str(r.total)),
            "transaction_count": r.count,
            "cash": Decimal(str(r.cash)),
            "gpay": Decimal(str(r.gpay)),
            "phonepe": Decimal(str(r.phonepe)),
            "bank_transfer": Decimal(str(r.bank_transfer)),
        }
        for r in results
    ]

    total_collected = sum(e["total_amount"] for e in entries)

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

    loan_sub = (
        db.query(
            Loan.customer_id,
            func.count(Loan.id).label("active_loans"),
            func.coalesce(func.sum(Loan.principal), 0).label("principal"),
        )
        .filter(Loan.status == LoanStatus.ACTIVE, Loan.is_deleted == False)
        .group_by(Loan.customer_id)
        .subquery()
    )

    txn_sub = (
        db.query(
            Loan.customer_id,
            func.coalesce(func.sum(Transaction.amount), 0).label("paid"),
        )
        .join(Transaction, Transaction.loan_id == Loan.id)
        .filter(
            Loan.status == LoanStatus.ACTIVE,
            Loan.is_deleted == False,
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted == False,
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
            func.coalesce(txn_sub.c.paid, 0).label("paid"),
        )
        .outerjoin(loan_sub, loan_sub.c.customer_id == Customer.id)
        .outerjoin(txn_sub, txn_sub.c.customer_id == Customer.id)
        .filter(Customer.is_deleted == False)
        .all()
    )

    results = []
    for r in rows:
        outstanding = Decimal(str(r.principal)) - Decimal(str(r.paid))
        results.append(
            {
                "customer_id": str(r.id),
                "customer_name": r.full_name,
                "mobile_number": r.mobile_number,
                "active_loans": r.active_loans,
                "total_principal": r.principal,
                "total_paid": r.paid,
                "total_outstanding": max(outstanding, Decimal("0")),
            }
        )

    return {
        "total_customers": len(results),
        "customers_with_active_loans": len(
            [x for x in results if x["active_loans"] > 0]
        ),
        "results": sorted(results, key=lambda x: x["total_outstanding"], reverse=True),
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

    collections_sub = (
        db.query(
            Transaction.collected_by_id.label("emp_id"),
            func.coalesce(func.sum(Transaction.amount), 0).label("total_amount"),
            func.count(Transaction.id).label("txn_count"),
        )
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
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
            "total_collections": Decimal(str(r.total_collections)),
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

    rows = (
        db.query(
            func.to_char(Transaction.created_at, "YYYY-MM").label("month"),
            func.coalesce(func.sum(Transaction.amount), 0).label("amount"),
        )
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted == False,
        )
        .group_by(func.to_char(Transaction.created_at, "YYYY-MM"))
        .order_by(func.to_char(Transaction.created_at, "YYYY-MM"))
        .all()
    )

    return [{"month": r.month, "amount": Decimal(str(r.amount))} for r in rows]


# --------------------------------------------------
# Trends
# --------------------------------------------------
def get_monthly_trends(db: Session) -> dict:

    customers = (
        db.query(
            func.to_char(Customer.created_at, "YYYY-MM").label("month"),
            func.count(Customer.id).label("count"),
        )
        .filter(Customer.is_deleted == False)
        .group_by(func.to_char(Customer.created_at, "YYYY-MM"))
        .order_by(func.to_char(Customer.created_at, "YYYY-MM"))
        .all()
    )

    loans = (
        db.query(
            func.to_char(Loan.created_at, "YYYY-MM").label("month"),
            func.count(Loan.id).label("count"),
        )
        .filter(Loan.is_deleted == False)
        .group_by(func.to_char(Loan.created_at, "YYYY-MM"))
        .order_by(func.to_char(Loan.created_at, "YYYY-MM"))
        .all()
    )

    collections = (
        db.query(
            func.to_char(Transaction.created_at, "YYYY-MM").label("month"),
            func.coalesce(func.sum(Transaction.amount), 0).label("amount"),
        )
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted == False,
        )
        .group_by(func.to_char(Transaction.created_at, "YYYY-MM"))
        .order_by(func.to_char(Transaction.created_at, "YYYY-MM"))
        .all()
    )

    return {
        "new_customers": [{"month": r.month, "count": r.count} for r in customers],
        "new_loans": [{"month": r.month, "count": r.count} for r in loans],
        "collections": [
            {"month": r.month, "amount": Decimal(str(r.amount))} for r in collections
        ],
    }
