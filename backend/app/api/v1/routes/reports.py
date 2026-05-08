import io
import csv

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from sqlalchemy.orm import Session
from typing import Literal

from app.core.db import get_db
from app.dependencies.auth import require_admin
from app.models.user import User
from app.schemas.report import (
    ChartEntry,
    CollectionReport,
    CustomerReport,
    DashboardSummary,
    EmployeeReport,
    LoanPortfolioReport,
    MonthlyTrends,
)
from app.services.report import (
    get_collection_report,
    get_customer_report,
    get_dashboard_summary,
    get_employee_report,
    get_loan_portfolio,
    get_collection_chart,
    get_monthly_trends,
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
    period: Literal["daily", "monthly"] = Query("daily"),
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


# --------------------------------------------------
# CSV Exports
# --------------------------------------------------
@router.get(
    "/customers/export",
    summary="Export customer report as CSV",
    response_class=StreamingResponse,
)
def export_customers(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    data = get_customer_report(db)

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow(
        ["Customer Name", "Mobile", "Active Loans", "Principal", "Paid", "Outstanding"]
    )

    for row in data["results"]:
        writer.writerow(
            [
                row["customer_name"],
                row["mobile_number"],
                row["active_loans"],
                row["total_principal"],
                row["total_paid"],
                row["total_outstanding"],
            ]
        )

    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=customers_report.csv"},
    )


# --------------------------------------------------
# Charts
# --------------------------------------------------
@router.get(
    "/charts/collections",
    response_model=list[ChartEntry],
    summary="Monthly collection totals for charting",
)
def chart_collections(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return get_collection_chart(db)


# --------------------------------------------------
# Trends
# --------------------------------------------------
@router.get(
    "/trends",
    response_model=MonthlyTrends,
    summary="Month-by-month new customers, new loans, and collections",
)
def trends(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return get_monthly_trends(db)
