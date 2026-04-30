from decimal import Decimal
from typing import Optional
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

    # AKTODO: Improve this
    # Loan counts by status
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

    total_vehicles = (
        db.query(func.count(Vehicle.id)).filter(Vehicle.is_deleted == False).scalar()
    )

    total_documents = (
        db.query(func.count(Document.id)).filter(Document.is_deleted == False).scalar()
    )

    # Financial totals
    total_principal = (
        db.query(func.coalesce(func.sum(Loan.principal), 0))
        .filter(Loan.is_deleted == False, Loan.status == LoanStatus.ACTIVE)
        .scalar()
    )

    total_collected = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.is_deleted == False,
            Transaction.status == TransactionStatus.SUCCESS,
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
        "total_principal_outstanding": Decimal(str(total_principal)),
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

    total_collected = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted == False,
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
        "total_payable": total_principal,
        "total_collected": total_collected,
        "total_outstanding": total_principal - total_collected,
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

    rows = (
        db.query(
            Customer.id,
            Customer.full_name,
            Customer.mobile_number,
            func.count(Loan.id).label("active_loans"),
            func.coalesce(func.sum(Loan.principal), 0).label("principal"),
            func.coalesce(func.sum(Transaction.amount), 0).label("paid"),
        )
        .outerjoin(
            Loan,
            and_(
                Loan.customer_id == Customer.id,
                Loan.status == LoanStatus.ACTIVE,
                Loan.is_deleted == False,
            ),
        )
        .outerjoin(
            Transaction,
            and_(
                Transaction.loan_id == Loan.id,
                Transaction.status == TransactionStatus.SUCCESS,
                Transaction.is_deleted == False,
            ),
        )
        .filter(Customer.is_deleted == False)
        .group_by(Customer.id)
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
    """Employee collection performance"""

    employees = (
        db.query(User).filter(User.is_deleted == False, User.is_active == True).all()
    )

    results = []

    for emp in employees:
        assigned = (
            db.query(func.count(Customer.id))
            .filter(
                Customer.assigned_employee_id == emp.id, Customer.is_deleted == False
            )
            .scalar()
        )

        collections = (
            db.query(
                func.coalesce(func.sum(Transaction.amount), 0),
                func.count(Transaction.id),
            )
            .filter(
                Transaction.collected_by_id == emp.id,
                Transaction.status == TransactionStatus.SUCCESS,
                Transaction.is_deleted == False,
            )
            .first()
        )

        # AKTODO: Add employee type as well
        results.append(
            {
                "employee_id": str(emp.id),
                "employee_name": emp.username,
                "assigned_customers": assigned,
                "total_collections": Decimal(str(collections[0])),
                "transaction_count": collections[1],
            }
        )

    # Sort by collections descending
    results.sort(key=lambda x: x["total_collections"], reverse=True)

    return {"results": results}


# --------------------------------------------------
# Charts
# --------------------------------------------------


##AKTODO: Charts and Trends not working check later
def get_collection_chart(db: Session):

    rows = (
        db.query(
            func.to_char(Transaction.created_at, "YYYY-MM").label("month"),
            func.sum(Transaction.amount),
        )
        .filter(
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted == False,
        )
        .group_by("month")
        .order_by("month")
        .all()
    )

    return [{"month": r.month, "amount": r[1]} for r in rows]


# --------------------------------------------------
# Trends
# --------------------------------------------------
def get_monthly_trends(db: Session):

    customers = (
        db.query(func.to_char(Customer.created_at, "YYYY-MM"), func.count(Customer.id))
        .group_by(1)
        .all()
    )

    loans = (
        db.query(func.to_char(Loan.created_at, "YYYY-MM"), func.count(Loan.id))
        .group_by(1)
        .all()
    )

    collections = (
        db.query(
            func.to_char(Transaction.created_at, "YYYY-MM"),
            func.sum(Transaction.amount),
        )
        .filter(Transaction.status == TransactionStatus.SUCCESS)
        .group_by(1)
        .all()
    )

    return {
        "new_customers": customers,
        "new_loans": loans,
        "collections": collections,
    }
