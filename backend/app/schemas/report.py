import uuid
from datetime import date as date_type
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from app.models.user import UserRole


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
    # Lifetime SUCCESS + REGULAR (non-down-payment) EMI collected across all
    # non-deleted loans, including CLOSED ones — so historical collections
    # don't disappear when a loan closes.
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
    # Catches any PaymentMethod enum value not in the four known buckets,
    # so cash + gpay + phonepe + bank_transfer + other == total_amount holds.
    other: Decimal


class CollectionReport(BaseModel):
    period: Literal["daily", "monthly"]
    total_collected: Decimal
    total_transactions: int
    entries: list[CollectionEntry]


# --------------------------------------------------
# CUSTOMER REPORT
# --------------------------------------------------
class CustomerStat(BaseModel):
    customer_id: uuid.UUID
    customer_name: str
    mobile_number: str
    active_loans: int
    total_principal: Decimal
    total_paid: Decimal
    total_outstanding: Decimal


class CustomerReport(BaseModel):
    total_customers: int
    customers_with_active_loans: int
    page: int
    page_size: int
    results: list[CustomerStat]


# --------------------------------------------------
# EMPLOYEE PERFORMANCE
# --------------------------------------------------
class EmployeePerformance(BaseModel):
    employee_id: uuid.UUID
    employee_name: str
    role: UserRole
    # False when the user has been deactivated or soft-deleted; the row is
    # still included so historical collections are attributable.
    is_active: bool
    assigned_customers: int
    total_collections: Decimal
    transaction_count: int


class EmployeeReport(BaseModel):
    total_employees: int
    total_collections: Decimal
    total_transactions: int
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


# --------------------------------------------------
# DAY REPORT (daily cash book)
# --------------------------------------------------
class DayReportReceipt(BaseModel):
    transaction_id: uuid.UUID
    loan_id: uuid.UUID
    loan_number: str
    hp_number: str | None
    customer_id: uuid.UUID
    customer_name: str
    transaction_type: str   # REGULAR | DOWN_PAYMENT
    payment_mode: str
    cycle_number: int | None
    collected_by: str | None
    amount: Decimal


class DayReportPayment(BaseModel):
    loan_id: uuid.UUID
    loan_number: str
    hp_number: str | None
    customer_id: uuid.UUID
    customer_name: str
    description: str
    amount: Decimal


class DayReportDay(BaseModel):
    date: date_type
    opening_balance: Decimal
    closing_balance: Decimal
    total_receipts: Decimal
    total_payments: Decimal
    emi_collection: Decimal
    down_payments: Decimal
    receipts: list[DayReportReceipt]
    payments: list[DayReportPayment]


class DayReport(BaseModel):
    date1: date_type
    date2: date_type
    # Net collections-minus-disbursements position — the system doesn't track
    # expenses/capital, so this is a cash-movement rollup, not a bank balance.
    opening_balance: Decimal
    closing_balance: Decimal
    total_receipts: Decimal
    total_payments: Decimal
    total_emi_collection: Decimal
    total_down_payments: Decimal
    cash: Decimal
    gpay: Decimal
    phonepe: Decimal
    bank_transfer: Decimal
    other: Decimal
    # One section per day WITH activity; quiet days are omitted (balances
    # still roll straight through them).
    days: list[DayReportDay]


# --------------------------------------------------
# RECEIVED INTEREST
# --------------------------------------------------
class ReceivedInterestRow(BaseModel):
    loan_id: uuid.UUID
    loan_number: str
    hp_number: str | None
    customer_id: uuid.UUID
    customer_name: str
    amount_paid: Decimal
    received_interest: Decimal
    transaction_count: int


class ReceivedInterestReport(BaseModel):
    date1: date_type
    date2: date_type
    total_amount_paid: Decimal
    total_received_interest: Decimal
    results: list[ReceivedInterestRow]
