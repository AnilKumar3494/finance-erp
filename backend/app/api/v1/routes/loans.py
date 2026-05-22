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
    LoanApproveRequest,
    LoanCreate,
    LoanListResponse,
    LoanResponse,
    LoanUpdate,
    UserNested,
    VehicleNested,
)
from app.schemas.loan_closure import LoanCloseRequest, LoanClosureResponse
from app.services.loan import (
    approve_loan,
    calculate_monthly_interest,
    calculate_total_payable,
    create_loan,
    get_active_loans_by_customer,
    get_loan,
    list_loans,
    parse_includes,
    soft_delete_loan,
    update_loan,
)
from app.services.loan_closure import close_loan as close_loan_with_closure

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
    response.net_loan_principal = loan.principal - loan.down_payment
    response.net_disbursed_amount = (
        loan.principal - loan.down_payment - loan.processing_fee - loan.documentation_fee
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
        # 400 for input/validation failures (e.g. DP >= principal, customer not found).
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# --------------------------------------------------
# APPROVE (DRAFT → ACTIVE)
# Admin/Super-Admin only. Generates the due-cycle schedule and the
# DOWN_PAYMENT transaction (if any) atomically.
# --------------------------------------------------
@router.post(
    "/{loan_id}/approve",
    response_model=LoanResponse,
    summary="Approve a DRAFT loan: generate schedule, record down payment",
)
def approve_loan_route(
    loan_id: uuid.UUID,
    payload: LoanApproveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    loan = get_loan(db, loan_id)
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )
    if loan.status != LoanStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only DRAFT loans can be approved; this loan is {loan.status.value}",
        )
    try:
        approved = approve_loan(
            db=db,
            loan=loan,
            approved_by=current_user.id,
            down_payment_mode=(
                payload.down_payment_mode.value if payload.down_payment_mode else None
            ),
        )
        return enrich_loan(approved)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


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
# UPDATE — ADMIN / SUPER_ADMIN only
#
# Locked to a small set of source statuses:
#   - DRAFT  : full edit (loan hasn't been approved yet)
#   - ACTIVE : edit allowed, but financially heavy (the schedule does NOT
#              auto-regenerate; an admin who changes principal/rate/tenure
#              on an active loan is taking responsibility for the divergence
#              with the existing due_cycles).
# CLOSED / BAD_DEBT_PROPOSED / BAD_DEBT / AWAITING_CLOSURE are immutable —
# preserves audit and prevents the "edit-after-settled" defect (review L1/L2).
# --------------------------------------------------
_EDITABLE_LOAN_STATUSES = {LoanStatus.DRAFT, LoanStatus.ACTIVE}


@router.patch("/{loan_id}", response_model=LoanResponse, summary="Update loan details")
def update_loan_route(
    loan_id: uuid.UUID,
    payload: LoanUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # admin / super-admin only
):
    loan = get_loan(db, loan_id)
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )

    if not payload.model_dump(exclude_unset=True):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided to update",
        )

    if loan.status not in _EDITABLE_LOAN_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Loan in status {loan.status.value} is immutable. "
                "Edits are only permitted in DRAFT or ACTIVE."
            ),
        )

    # SUPER_ADMIN-only fields (extra-sensitive on an ACTIVE loan, since changing
    # them after the schedule was generated invalidates outstanding math). On a
    # DRAFT loan they're fine for any admin; on an ACTIVE loan, require super-admin.
    sensitive_fields_on_active = {
        "principal",
        "interest_rate",
        "tenure",
        "down_payment",
    }
    requested = set(payload.model_dump(exclude_unset=True).keys())
    if (
        loan.status == LoanStatus.ACTIVE
        and requested & sensitive_fields_on_active
        and current_user.role != UserRole.SUPER_ADMIN
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Editing principal / interest_rate / tenure / down_payment on "
                "an ACTIVE loan requires SUPER_ADMIN — these changes do not "
                "regenerate the schedule and affect outstanding balance."
            ),
        )

    return enrich_loan(
        update_loan(db=db, loan=loan, data=payload, updated_by=current_user.id)
    )


# --------------------------------------------------
# CLOSE LOAN (admin-controlled, with closure form)
# Captures closure_type, charges, NOC, etc. Writes a `loan_closures` row.
# Replaces the old auto-close behaviour from confirm_transaction.
# --------------------------------------------------
@router.post(
    "/{loan_id}/close",
    response_model=LoanClosureResponse,
    summary="Close a loan with full closure form (admin)",
)
def close_loan_route(
    loan_id: uuid.UUID,
    payload: LoanCloseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    # Lock the loan to serialise concurrent close attempts / confirmations.
    loan = (
        db.query(Loan)
        .filter(Loan.id == loan_id, Loan.is_deleted.is_(False))
        .with_for_update()
        .first()
    )
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )

    try:
        closure = close_loan_with_closure(
            db=db, loan=loan, data=payload, closed_by=current_user.id
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        ) from e

    db.commit()
    db.refresh(closure)
    return closure


# --------------------------------------------------
# (REMOVED) Direct mark-bad-debt route.
# Bad-debt is now a two-step propose / review flow:
#   POST /api/v1/loans/{id}/bad-debt/propose   (any authenticated user)
#   POST /api/v1/bad-debt-proposals/{id}/review (admin/super-admin)
# To formally write-off an approved proposal, admin uses:
#   POST /api/v1/loans/{id}/close  with closure_type=WRITE_OFF
# --------------------------------------------------


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
