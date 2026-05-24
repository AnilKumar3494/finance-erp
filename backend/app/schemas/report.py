from decimal import Decimal
from pydantic import BaseModel


# --------------------------------------------------
# DASHBOARD SUMMARY
# --------------------------------------------------
class DashboardSummary(BaseModel):
    total_customers: int
    total_draft_loans: int
    total_active_loans: int
    total_awaiting_closure_loans: int
    total_closed_loans: int
    total_bad_debt_proposed_loans: int
    total_bad_debt_loans: int
    total_vehicles: int
    total_documents: int

    # Financial — sourced from the due-cycles ledger for open loans.
    # total_principal_outstanding and total_pending_collections are the same
    # number expressed two ways (kept as separate fields for UI clarity).
    total_principal_outstanding: Decimal
    total_amount_collected: Decimal
    total_pending_collections: Decimal


# --------------------------------------------------
# LOAN PORTFOLIO
# --------------------------------------------------
class LoanPortfolioReport(BaseModel):
    total_loans: int
    draft_loans: int
    active_loans: int
    awaiting_closure_loans: int
    closed_loans: int
    bad_debt_proposed_loans: int
    bad_debt_loans: int
    total_principal: Decimal
    # total_payable = principal + interest + penalty add-ons, summed from
    # due_cycles.total_due for currently-open loans.
    total_payable: Decimal
    total_collected: Decimal
    total_outstanding: Decimal
    average_interest_rate: Decimal
    average_tenure: Decimal


# --------------------------------------------------
# COLLECTION REPORT
# --------------------------------------------------
class CollectionEntry(BaseModel):
    date: str
    total_amount: Decimal
    transaction_count: int
    cash: Decimal
    gpay: Decimal
    phonepe: Decimal
    bank_transfer: Decimal


class CollectionReport(BaseModel):
    period: str  # "daily" or "monthly"
    total_collected: Decimal
    total_transactions: int
    entries: list[CollectionEntry]


# --------------------------------------------------
# CUSTOMER REPORT
# --------------------------------------------------
class CustomerStat(BaseModel):
    customer_id: str
    customer_name: str
    mobile_number: str
    active_loans: int
    total_principal: Decimal
    total_paid: Decimal
    total_outstanding: Decimal


class CustomerReport(BaseModel):
    total_customers: int
    customers_with_active_loans: int
    results: list[CustomerStat]


# --------------------------------------------------
# EMPLOYEE PERFORMANCE
# --------------------------------------------------
class EmployeePerformance(BaseModel):
    employee_id: str
    employee_name: str
    role: str
    assigned_customers: int
    total_collections: Decimal
    transaction_count: int


class EmployeeReport(BaseModel):
    results: list[EmployeePerformance]


# --------------------------------------------------
# CHARTS
# --------------------------------------------------
class ChartEntry(BaseModel):
    month: str   # "YYYY-MM"
    amount: Decimal


# --------------------------------------------------
# MONTHLY TRENDS
# --------------------------------------------------
class MonthlyCount(BaseModel):
    month: str   # "YYYY-MM"
    count: int


class MonthlyAmount(BaseModel):
    month: str   # "YYYY-MM"
    amount: Decimal


class MonthlyTrends(BaseModel):
    new_customers: list[MonthlyCount]
    new_loans: list[MonthlyCount]
    collections: list[MonthlyAmount]
