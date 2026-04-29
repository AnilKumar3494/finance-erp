from decimal import Decimal
from typing import Optional
from datetime import datetime

from pydantic import BaseModel


# --------------------------------------------------
# DASHBOARD SUMMARY
# --------------------------------------------------
class DashboardSummary(BaseModel):
    total_customers: int
    total_active_loans: int
    total_closed_loans: int
    total_bad_debt_loans: int
    total_vehicles: int
    total_documents: int

    # Financial
    total_principal_outstanding: Decimal
    total_amount_collected: Decimal
    total_pending_collections: Decimal


# --------------------------------------------------
# LOAN PORTFOLIO
# --------------------------------------------------
class LoanPortfolioReport(BaseModel):
    total_loans: int
    active_loans: int
    closed_loans: int
    bad_debt_loans: int
    total_principal: Decimal
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
    assigned_customers: int
    total_collections: Decimal
    transaction_count: int


class EmployeeReport(BaseModel):
    results: list[EmployeePerformance]
