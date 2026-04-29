from decimal import Decimal
from typing import Optional
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, case, and_
from sqlalchemy.orm import Session

from app.models.customer import Customer
from app.models.document import Document
from app.models.loan import Loan, LoanStatus
from app.models.transaction import Transaction, TransactionStatus, PaymentMethod
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.services.loan import calculate_total_payable


# --------------------------------------------------
# DASHBOARD SUMMARY
# --------------------------------------------------
def get_dashboard_summary(db: Session) -> dict:
    """High level overview for admin dashboard"""

    total_customers = (
        db.query(func.count(Customer.id)).filter(Customer.is_deleted == False).scalar()
    )

    # Loan counts by status
    loan_counts = (
        db.query(Loan.status, func.count(Loan.id))
        .filter(Loan.is_deleted == False)
        .group_by(Loan.status)
        .all()
    )

    loan_map = {str(s): c for s, c in loan_counts}

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
        "total_active_loans": loan_map.get("ACTIVE", 0),
        "total_closed_loans": loan_map.get("CLOSED", 0),
        "total_bad_debt_loans": loan_map.get("BAD_DEBT", 0),
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
    """Detailed loan statistics"""

    loans = db.query(Loan).filter(Loan.is_deleted == False).all()

    if not loans:
        return {
            "total_loans": 0,
            "active_loans": 0,
            "closed_loans": 0,
            "bad_debt_loans": 0,
            "total_principal": Decimal("0"),
            "total_payable": Decimal("0"),
            "total_collected": Decimal("0"),
            "total_outstanding": Decimal("0"),
            "average_interest_rate": Decimal("0"),
            "average_tenure": Decimal("0"),
        }

    active = [l for l in loans if l.status == LoanStatus.ACTIVE]
    closed = [l for l in loans if l.status == LoanStatus.CLOSED]
    bad_debt = [l for l in loans if l.status == LoanStatus.BAD_DEBT]

    total_principal = sum(l.principal for l in loans)
    total_payable = sum(
        calculate_total_payable(l.principal, l.interest_rate, l.tenure) for l in loans
    )

    total_collected = Decimal(
        str(
            db.query(func.coalesce(func.sum(Transaction.amount), 0))
            .filter(
                Transaction.is_deleted == False,
                Transaction.status == TransactionStatus.SUCCESS,
            )
            .scalar()
        )
    )

    avg_rate = sum(l.interest_rate for l in loans) / len(loans)
    avg_tenure = sum(l.tenure for l in loans) / len(loans)

    return {
        "total_loans": len(loans),
        "active_loans": len(active),
        "closed_loans": len(closed),
        "bad_debt_loans": len(bad_debt),
        "total_principal": total_principal,
        "total_payable": total_payable,
        "total_collected": total_collected,
        "total_outstanding": max(total_payable - total_collected, Decimal("0")),
        "average_interest_rate": round(avg_rate, 2),
        "average_tenure": round(Decimal(str(avg_tenure)), 1),
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
    """Customer stats with outstanding balances"""

    customers = db.query(Customer).filter(Customer.is_deleted == False).all()

    results = []
    customers_with_loans = 0

    for customer in customers:
        active_loans = (
            db.query(Loan)
            .filter(
                Loan.customer_id == customer.id,
                Loan.status == LoanStatus.ACTIVE,
                Loan.is_deleted == False,
            )
            .all()
        )

        if active_loans:
            customers_with_loans += 1

        total_principal = sum(l.principal for l in active_loans)
        total_payable = sum(
            calculate_total_payable(l.principal, l.interest_rate, l.tenure)
            for l in active_loans
        )

        total_paid = (
            Decimal(
                str(
                    db.query(func.coalesce(func.sum(Transaction.amount), 0))
                    .filter(
                        Transaction.loan_id.in_([l.id for l in active_loans]),
                        Transaction.status == TransactionStatus.SUCCESS,
                        Transaction.is_deleted == False,
                    )
                    .scalar()
                )
            )
            if active_loans
            else Decimal("0")
        )

        results.append(
            {
                "customer_id": str(customer.id),
                "customer_name": customer.full_name,
                "mobile_number": customer.mobile_number,
                "active_loans": len(active_loans),
                "total_principal": total_principal,
                "total_paid": total_paid,
                "total_outstanding": max(total_payable - total_paid, Decimal("0")),
            }
        )

    # Sort by outstanding descending
    results.sort(key=lambda x: x["total_outstanding"], reverse=True)

    return {
        "total_customers": len(customers),
        "customers_with_active_loans": customers_with_loans,
        "results": results,
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

        results.append(
            {
                "employee_id": str(emp.id),
                "employee_name": emp.full_name or emp.username,
                "assigned_customers": assigned,
                "total_collections": Decimal(str(collections[0])),
                "transaction_count": collections[1],
            }
        )

    # Sort by collections descending
    results.sort(key=lambda x: x["total_collections"], reverse=True)

    return {"results": results}
