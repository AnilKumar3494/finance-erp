import csv
import io
from typing import Iterator, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import require_admin, require_report_access
from app.models.user import User, UserRole
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
    count_customers,
    get_collection_chart,
    get_collection_report,
    get_customer_report,
    get_dashboard_summary,
    get_employee_report,
    get_loan_portfolio,
    get_monthly_trends,
    iter_customer_report_rows,
)
from app.utils.audit import write_audit

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
# CUSTOMER REPORT (paginated)
# --------------------------------------------------
def _scope_to_employee(current_user: User):
    """
    Map an allowlisted caller to a customer-visibility scope.

    Returns the user's id for EMPLOYEE (scoped to assigned customers),
    None for ADMIN / SUPER_ADMIN (full tenant). Any other role is rejected
    — though in practice it cannot reach here because the route depends on
    `require_report_access`, which already gates the allowlist.
    """
    if current_user.role == UserRole.EMPLOYEE:
        return current_user.id
    if current_user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        return None
    # Belt-and-suspenders: if the role allowlist is ever loosened without
    # updating this helper, we fail closed rather than leak PII.
    from fastapi import HTTPException, status as http_status

    raise HTTPException(
        status_code=http_status.HTTP_403_FORBIDDEN,
        detail="Role not permitted on customer reports.",
    )


@router.get(
    "/customers",
    response_model=CustomerReport,
    summary="Customer stats with outstanding balances (paginated)",
)
def customer_report(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort_by: Optional[str] = Query(
        None,
        description="Sort column: full_name | mobile_number | active_loans | principal | paid | outstanding",
    ),
    sort_order: Optional[str] = Query(None, description="asc | desc (default desc)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_report_access),
):
    scope = _scope_to_employee(current_user)
    report = get_customer_report(
        db,
        page=page,
        page_size=page_size,
        assigned_employee_id=scope,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    # R1: the JSON listing of customer rows is the same PII surface the
    # CSV export streams — auditing only the CSV path made the JSON view
    # an unaudited PII-pull lane. We log structural facts only (count,
    # page, scope) — never the rows themselves, which contain customer
    # names + masked PII.
    #
    # Audit goes through the SAVEPOINT helper, so a write failure can't
    # break the report response.
    rows_on_page = (
        len(report.get("results", [])) if isinstance(report, dict) else 0
    )
    total_eligible = (
        report.get("total_customers") if isinstance(report, dict) else None
    )
    write_audit(
        db,
        action_type="CUSTOMER_REPORT_VIEW",
        target_table="customers",
        user_id=current_user.id,
        new_data={
            "row_count_on_page": rows_on_page,
            "total_eligible": total_eligible,
            "page": page,
            "page_size": page_size,
            "format": "json",
            "scope": "self" if scope is not None else "all",
        },
        request=request,
    )
    db.commit()
    return report


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
# Cells starting with any of these characters are interpreted as formulas by
# Excel / Google Sheets and can exfil data or run commands. Prefix them with
# a single quote so the spreadsheet treats them as literal text.
_CSV_INJECTION_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(value) -> str:
    """Stringify and neutralise CSV-injection payloads in user-controlled cells."""
    if value is None:
        return ""
    s = str(value)
    if s and s[0] in _CSV_INJECTION_TRIGGERS:
        return "'" + s
    return s


def _stream_customers_csv(db: Session, assigned_employee_id) -> Iterator[str]:
    """
    Generator that yields the CSV one row at a time so a multi-MB export
    doesn't buffer in worker memory. Starts with a UTF-8 BOM so Excel on
    Windows renders non-ASCII names correctly.
    """
    # Prepend BOM so Excel auto-detects UTF-8.
    yield "﻿"

    buf = io.StringIO()
    writer = csv.writer(buf)

    def _flush() -> str:
        chunk = buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        return chunk

    writer.writerow(
        ["Customer Name", "Mobile", "Active Loans", "Principal", "Paid", "Outstanding"]
    )
    yield _flush()

    for row in iter_customer_report_rows(
        db, assigned_employee_id=assigned_employee_id
    ):
        writer.writerow(
            [
                _csv_safe(row["customer_name"]),
                _csv_safe(row["mobile_number"]),
                row["active_loans"],
                str(row["total_principal"]),
                str(row["total_paid"]),
                str(row["total_outstanding"]),
            ]
        )
        yield _flush()


@router.get(
    "/customers/export",
    summary="Export customer report as CSV (streamed)",
    response_class=StreamingResponse,
)
def export_customers(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_report_access),
):
    # EMPLOYEE callers can only export their own assigned customers; ADMIN +
    # SUPER_ADMIN see the full tenant.
    scope = _scope_to_employee(current_user)

    # Audit BEFORE the stream starts so the compliance record exists even
    # if the client aborts mid-download. The row count is the eligible total
    # at audit-write time — close enough for compliance lookback.
    row_count = count_customers(db, assigned_employee_id=scope)
    write_audit(
        db,
        action_type="CUSTOMER_REPORT_EXPORT",
        target_table="customers",
        user_id=current_user.id,
        new_data={
            "row_count": row_count,
            "format": "csv",
            "scope": "self" if scope is not None else "all",
        },
        request=request,
    )
    db.commit()

    return StreamingResponse(
        _stream_customers_csv(db, assigned_employee_id=scope),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=customers_report.csv"},
    )


# --------------------------------------------------
# Charts
# --------------------------------------------------
@router.get(
    "/charts/collections",
    response_model=list[ChartEntry],
    summary="Monthly collection totals for charting (trailing window)",
)
def chart_collections(
    months: int = Query(12, ge=1, le=60),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return get_collection_chart(db, months=months)


# --------------------------------------------------
# Trends
# --------------------------------------------------
@router.get(
    "/trends",
    response_model=MonthlyTrends,
    summary="Month-by-month new customers, new loans, and collections (trailing window)",
)
def trends(
    months: int = Query(12, ge=1, le=60),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return get_monthly_trends(db, months=months)
