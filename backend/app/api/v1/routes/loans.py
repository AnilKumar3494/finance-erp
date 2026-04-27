import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin

from app.models.user import User, UserRole
from app.models.customer import Customer
from app.models.vehicle import Vehicle
from app.models.loan import LoanStatus

from app.schemas.loan import (
    LoanCreate,
    LoanListResponse,
    LoanResponse,
    LoanUpdate,
)
from app.services.loan import (
    calculate_monthly_interest,
    calculate_total_payable,
    close_loan,
    create_loan,
    get_active_loans_by_customer,
    get_loan,
    list_loans,
    mark_bad_debt,
    soft_delete_loan,
    update_loan,
)

router = APIRouter(prefix="/loans", tags=["Loans"])


# --------------------------------------------------
# HELPER — Attach computed fields to response
# --------------------------------------------------
def enrich_loan(loan) -> LoanResponse:
    response = LoanResponse.model_validate(loan)
    response.monthly_interest = calculate_monthly_interest(
        loan.principal, loan.interest_rate
    )
    response.total_payable = calculate_total_payable(
        loan.principal, loan.interest_rate, loan.tenure
    )
    return response


# --------------------------------------------------
# CREATE
# --------------------------------------------------
@router.post(
    "/",
    response_model=LoanResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new loan",
)
def create_loan_route(
    payload: LoanCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        loan = create_loan(db=db, data=payload, created_by=current_user.id)
        return enrich_loan(loan)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


# --------------------------------------------------
# LIST
# --------------------------------------------------
@router.get("/", response_model=LoanListResponse, summary="List loans with filters")
def list_all(
    customer_id: Optional[uuid.UUID] = Query(None),
    vehicle_id: Optional[uuid.UUID] = Query(None),
    status: Optional[LoanStatus] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    results, total = list_loans(
        db=db,
        customer_id=customer_id,
        vehicle_id=vehicle_id,
        status=status,
        page=page,
        page_size=page_size,
    )
    return LoanListResponse(
        total=total,
        page=page,
        page_size=page_size,
        results=[enrich_loan(l) for l in results],
    )


# --------------------------------------------------
# GET BY ID
# --------------------------------------------------
@router.get(
    "/{loan_id}", response_model=LoanResponse, summary="Get a single loan by ID"
)
def get_one(
    loan_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loan = get_loan(db, loan_id)
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )
    return enrich_loan(loan)


# --------------------------------------------------
# GET ACTIVE LOANS BY CUSTOMER
# --------------------------------------------------
@router.get(
    "/customer/{customer_id}/active",
    response_model=list[LoanResponse],
    summary="Get all active loans for a customer",
)
def get_customer_active_loans(
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loans = get_active_loans_by_customer(db, customer_id)
    return [enrich_loan(l) for l in loans]


# --------------------------------------------------
# UPDATE (Any logged-in user — status, vehicle, tenure)
# --------------------------------------------------
@router.patch("/{loan_id}", response_model=LoanResponse, summary="Update loan details")
def update_loan_route(
    loan_id: uuid.UUID,
    payload: LoanUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loan = get_loan(db, loan_id)
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )

    # Block non-admins from changing principal
    if payload.principal is not None and current_user.role != UserRole.Admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can update the principal amount",
        )

    return enrich_loan(
        update_loan(db=db, loan=loan, data=payload, updated_by=current_user.id)
    )


# --------------------------------------------------
# CLOSE LOAN
# --------------------------------------------------
@router.post(
    "/{loan_id}/close", response_model=LoanResponse, summary="Mark loan as closed"
)
def close_loan_route(
    loan_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loan = get_loan(db, loan_id)
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )
    if loan.status != LoanStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Loan is already {loan.status.value}",
        )
    return enrich_loan(close_loan(db=db, loan=loan, updated_by=current_user.id))


# --------------------------------------------------
# MARK BAD DEBT
# --------------------------------------------------
@router.post(
    "/{loan_id}/bad-debt", response_model=LoanResponse, summary="Mark loan as bad debt"
)
def mark_bad_debt_route(
    loan_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # Admin only
):
    loan = get_loan(db, loan_id)
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )
    if loan.status != LoanStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Loan is already {loan.status.value}",
        )
    return enrich_loan(mark_bad_debt(db=db, loan=loan, updated_by=current_user.id))


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
@router.delete(
    "/{loan_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Soft delete a loan"
)
def delete_loan_route(
    loan_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # Admin only
):
    loan = get_loan(db, loan_id)
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )
    soft_delete_loan(db=db, loan=loan, deleted_by=current_user.id)
