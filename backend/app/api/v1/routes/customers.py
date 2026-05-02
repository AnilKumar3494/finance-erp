import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin
from app.models.user import User, UserRole
from app.schemas.customer import (
    CustomerCreate,
    CustomerListResponse,
    CustomerResponse,
    CustomerUnmaskedPII,
    CustomerUpdate,
)
from app.services.customer import (
    create_customer,
    get_customer,
    get_customer_by_mobile,
    list_customers,
    soft_delete_customer,
    update_customer,
)

router = APIRouter(prefix="/customers", tags=["Customers"])


# --------------------------------------------------
# CREATE
# --------------------------------------------------
@router.post(
    "/",
    response_model=CustomerResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new customer",
)
def create(
    payload: CustomerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Check mobile duplicate
    if get_customer_by_mobile(db, payload.mobile_number):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Mobile number already registered",
        )

    try:
        return create_customer(db=db, data=payload, created_by=current_user.id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),  # Catches duplicate aadhaar/pan from DB
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create customer",
        )


# --------------------------------------------------
# LIST
# --------------------------------------------------
@router.get(
    "/",
    response_model=CustomerListResponse,
    summary="List all customers with search and pagination",
)
def list_all(
    search: Optional[str] = Query(
        None, description="Search by customer name, mobile, or employee name"
    ),
    assigned_employee_id: Optional[uuid.UUID] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    if current_user.role == UserRole.EMPLOYEE:
        assigned_employee_id = current_user.id

    results, total = list_customers(
        db=db,
        search=search,
        assigned_employee_id=assigned_employee_id,
        page=page,
        page_size=page_size,
    )
    return CustomerListResponse(
        total=total, page=page, page_size=page_size, results=results
    )


# --------------------------------------------------
# GET BY ID
# --------------------------------------------------
@router.get(
    "/{customer_id}",
    response_model=CustomerResponse,
    summary="Get a single customer by ID",
)
def get_one(
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    customer = get_customer(db, customer_id)
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )

    if (
        current_user.role == UserRole.EMPLOYEE
        and customer.assigned_employee_id != current_user.id
    ):
        raise HTTPException(
            status_code=403, detail="Access denied. Customer not assigned to you."
        )

    return customer


# --------------------------------------------------
# UNMASK PII (Admin Only)
# --------------------------------------------------
@router.get(
    "/{customer_id}/unmask",
    response_model=CustomerUnmaskedPII,
    summary="Get unmasked PII data (Admin Only)",
)
def get_unmasked_pii(
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # SECURITY: Admins only
):
    """
    Called by the frontend when the Admin clicks the 'Eye' icon to unmask data.
    """
    customer = get_customer(db, customer_id)
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )

    # FUTURE AUDIT TRIGGER: Log this action in the audit_logs table here.

    return CustomerUnmaskedPII(
        aadhaar_number=customer.aadhaar_number, pan_number=customer.pan_number
    )


# --------------------------------------------------
# UPDATE
# --------------------------------------------------
@router.patch(
    "/{customer_id}", response_model=CustomerResponse, summary="Update customer details"
)
def update(
    customer_id: uuid.UUID,
    payload: CustomerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    customer = get_customer(db, customer_id)
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )

    if (
        current_user.role == UserRole.EMPLOYEE
        and customer.assigned_employee_id != current_user.id
    ):
        raise HTTPException(
            status_code=403, detail="Access denied. Customer not assigned to you."
        )

    return update_customer(
        db=db, customer=customer, data=payload, updated_by=current_user.id
    )


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
@router.delete(
    "/{customer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft delete a customer",
)
def delete(
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # Admin only
):
    customer = get_customer(db, customer_id)
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )
    soft_delete_customer(db=db, customer=customer, deleted_by=current_user.id)
