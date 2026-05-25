"""
Centralized resource-access helpers.

Resolves the duplicated `_assert_loan_access` / `_ensure_loan_access` /
`_get_loan_with_access_check` implementations that previously lived in four
different route files (loans, due_cycles, personnel, stability_documents).

Two patterns are exposed:

  - `assert_loan_access(loan, user, db)` — pure function. Use this from a
    service or from a route that already has a loan instance in hand.

  - `loan_for_user(loan_id, db, current_user)` — FastAPI dependency.
    Use this as a route signature (`loan = Depends(loan_for_user)`) to
    fold the 404/403 boilerplate into the framework.

Both raise HTTPException so they're safe to call from a route, but
services that don't want HTTPException leakage should call
`is_customer_accessible` / `is_loan_accessible` directly.
"""
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Path, status
from sqlalchemy.orm import Session, joinedload

from app.core.db import get_db
from app.dependencies.auth import get_current_user
from app.models.customer import Customer
from app.models.loan import Loan
from app.models.user import User, UserRole

if TYPE_CHECKING:
    pass


# --------------------------------------------------
# Pure predicates (no HTTPException)
# --------------------------------------------------
def is_customer_accessible(customer: Customer, user: User) -> bool:
    """ADMIN/SUPER_ADMIN see all customers; EMPLOYEE only its assignees."""
    if user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        return True
    return customer.assigned_employee_id == user.id


def is_loan_accessible(loan: Loan, user: User, db: Session) -> bool:
    """A loan is accessible iff its (active) customer is accessible to the user."""
    if user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        return True
    customer = (
        db.query(Customer)
        .filter(Customer.id == loan.customer_id, Customer.is_deleted == False)  # noqa: E712
        .first()
    )
    return customer is not None and customer.assigned_employee_id == user.id


# --------------------------------------------------
# Assertion helpers (raise HTTPException)
# --------------------------------------------------
def assert_customer_access(customer: Customer, user: User) -> None:
    if not is_customer_accessible(customer, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )


def assert_loan_access(loan: Loan, user: User, db: Session) -> None:
    if not is_loan_accessible(loan, user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )


# --------------------------------------------------
# FastAPI dependencies — fold 404/403 into the signature
# --------------------------------------------------
def loan_for_user(
    loan_id: uuid.UUID = Path(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Loan:
    """Fetch an active loan and ensure the caller may access it.

    Returns the Loan instance with `customer` eager-loaded so callers can
    do further customer-level checks without an extra round-trip.
    """
    loan = (
        db.query(Loan)
        .options(joinedload(Loan.customer))
        .filter(Loan.id == loan_id, Loan.is_deleted == False)  # noqa: E712
        .first()
    )
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )
    assert_loan_access(loan, current_user, db)
    return loan


def customer_for_user(
    customer_id: uuid.UUID = Path(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Customer:
    """Fetch an active customer and ensure the caller may access it."""
    customer = (
        db.query(Customer)
        .filter(Customer.id == customer_id, Customer.is_deleted == False)  # noqa: E712
        .first()
    )
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )
    assert_customer_access(customer, current_user)
    return customer
