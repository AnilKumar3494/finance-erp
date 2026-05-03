import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin

from app.models.user import User, UserRole
from app.models.customer import Customer
from app.models.vehicle import Vehicle
from app.models.loan import Loan, LoanStatus

from app.schemas.loan import (
    CustomerNested,
    LoanCreate,
    LoanListResponse,
    LoanResponse,
    LoanUpdate,
    UserNested,
    VehicleNested,
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
    parse_includes,
    soft_delete_loan,
    update_loan,
)

router = APIRouter(prefix="/loans", tags=["Loans"])


# --------------------------------------------------
# HELPER — Attach computed fields + nested objects
# --------------------------------------------------
def enrich_loan(loan, includes: Optional[set[str]] = None) -> LoanResponse:
    """
    Build response with computed fields.
    If includes is provided, populate nested objects from eagerly-loaded relationships.
    """
    response = LoanResponse.model_validate(loan)
    response.monthly_interest = calculate_monthly_interest(
        loan.principal, loan.interest_rate
    )
    response.total_payable = calculate_total_payable(
        loan.principal, loan.interest_rate, loan.tenure
    )

    if includes:
        if "customer" in includes and loan.customer:
            response.customer = CustomerNested.model_validate(loan.customer)

        if "vehicle" in includes and loan.vehicle:
            response.vehicle = VehicleNested.model_validate(loan.vehicle)

        if "created_by" in includes and loan.created_by:
            response.created_by = UserNested.model_validate(loan.created_by)

        if "updated_by" in includes and loan.updated_by:
            response.updated_by = UserNested.model_validate(loan.updated_by)

    return response


def _assert_loan_access(loan: "Loan", current_user: User, db: Session) -> None:
    """Raise 403 if an employee tries to access a loan outside their assigned customers."""
    if current_user.role == UserRole.EMPLOYEE:
        customer = (
            db.query(Customer)
            .filter(
                Customer.id == loan.customer_id,
                Customer.assigned_employee_id == current_user.id,
                Customer.is_deleted == False,
            )
            .first()
        )
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this loan",
            )


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
    include: Optional[str] = Query(
        None,
        description="Comma-separated list of related objects to include: customer, vehicle, created_by, updated_by",
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assigned_employee_id = (
        current_user.id if current_user.role == UserRole.EMPLOYEE else None
    )
    includes = parse_includes(include)
    results, total = list_loans(
        db=db,
        customer_id=customer_id,
        vehicle_id=vehicle_id,
        status=status,
        page=page,
        page_size=page_size,
        assigned_employee_id=assigned_employee_id,
        include=include,
    )
    return LoanListResponse(
        total=total,
        page=page,
        page_size=page_size,
        results=[enrich_loan(l, includes) for l in results],
    )


# --------------------------------------------------
# GET BY ID
# --------------------------------------------------
@router.get(
    "/{loan_id}", response_model=LoanResponse, summary="Get a single loan by ID"
)
def get_one(
    loan_id: uuid.UUID,
    include: Optional[str] = Query(
        None,
        description="Comma-separated list of related objects to include: customer, vehicle, created_by, updated_by",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    includes = parse_includes(include)
    loan = get_loan(db, loan_id, include=include)
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )
    _assert_loan_access(loan, current_user, db)
    return enrich_loan(loan, includes)


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
    include: Optional[str] = Query(
        None,
        description="Comma-separated list of related objects to include: customer, vehicle, created_by, updated_by",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == UserRole.EMPLOYEE:
        customer = (
            db.query(Customer)
            .filter(
                Customer.id == customer_id,
                Customer.assigned_employee_id == current_user.id,
                Customer.is_deleted == False,
            )
            .first()
        )
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this customer's loans",
            )

    includes = parse_includes(include)
    loans = get_active_loans_by_customer(db, customer_id, include=include)
    return [enrich_loan(l, includes) for l in loans]


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

    _assert_loan_access(loan, current_user, db)

    if not payload.model_dump(exclude_unset=True):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided to update",
        )

    if current_user.role not in [UserRole.ADMIN, UserRole.SUPER_ADMIN]:
        if payload.principal is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admins can update the principal amount",
            )
        if payload.interest_rate is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admins can update the interest rate",
            )
        if payload.status is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admins can change loan status",
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
    current_user: User = Depends(require_admin),
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
    try:
        return enrich_loan(close_loan(db=db, loan=loan, updated_by=current_user.id))

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


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
    current_user: User = Depends(require_admin),
):
    loan = get_loan(db, loan_id)
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )

    if loan.status == LoanStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete an ACTIVE loan. Close or mark as bad debt first.",
        )

    soft_delete_loan(db=db, loan=loan, deleted_by=current_user.id)
