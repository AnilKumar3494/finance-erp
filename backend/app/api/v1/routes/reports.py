from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin
from app.models.user import User
from app.schemas.report import (
    CollectionReport,
    CustomerReport,
    DashboardSummary,
    EmployeeReport,
    LoanPortfolioReport,
)
from app.services.report import (
    get_collection_report,
    get_customer_report,
    get_dashboard_summary,
    get_employee_report,
    get_loan_portfolio,
)

router = APIRouter(prefix="/reports", tags=["Reports"])


# --------------------------------------------------
# DASHBOARD SUMMARY
# --------------------------------------------------
@router.get(
    "/summary",
    response_model=DashboardSummary,
    summary="Dashboard overview — counts + financial totals",
)
def dashboard_summary(
    db: Session = Depends(get_db), current_user: User = Depends(require_admin)
):
    return get_dashboard_summary(db)


# --------------------------------------------------
# LOAN PORTFOLIO
# --------------------------------------------------
@router.get(
    "/loans", response_model=LoanPortfolioReport, summary="Loan portfolio stats"
)
def loan_portfolio(
    db: Session = Depends(get_db), current_user: User = Depends(require_admin)
):
    return get_loan_portfolio(db)


# --------------------------------------------------
# COLLECTIONS
# --------------------------------------------------
@router.get(
    "/collections",
    response_model=CollectionReport,
    summary="Daily or monthly collection breakdown",
)
def collections(
    period: str = Query("daily", regex="^(daily|monthly)$"),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return get_collection_report(db, period=period, days=days)


# --------------------------------------------------
# CUSTOMER REPORT
# --------------------------------------------------
@router.get(
    "/customers",
    response_model=CustomerReport,
    summary="Customer stats with outstanding balances",
)
def customer_report(
    db: Session = Depends(get_db), current_user: User = Depends(require_admin)
):
    return get_customer_report(db)


# --------------------------------------------------
# EMPLOYEE PERFORMANCE
# --------------------------------------------------
@router.get(
    "/employees",
    response_model=EmployeeReport,
    summary="Employee collection performance",
)
def employee_report(
    db: Session = Depends(get_db), current_user: User = Depends(require_admin)
):
    return get_employee_report(db)
