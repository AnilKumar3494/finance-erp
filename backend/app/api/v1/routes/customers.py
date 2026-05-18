import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin
from app.dependencies.cache import no_store
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
    get_customer_by_idempotency_key,
    get_customer_by_mobile,
    list_customers,
    soft_delete_customer,
    update_customer,
    validate_assignable_employee,
)
from app.utils.audit import write_audit

router = APIRouter(prefix="/customers", tags=["Customers"])

_PRIVILEGED = (UserRole.ADMIN, UserRole.SUPER_ADMIN)


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
    request: Request,
    payload: CustomerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    idempotency_key: Optional[str] = Header(
        None,
        alias="Idempotency-Key",
        max_length=64,
        description="Optional. Retried POSTs with the same key return the "
        "originally-created customer instead of creating a duplicate.",
    ),
):
    # --- RBAC: resolve assigned_employee_id BEFORE any idempotency check ---
    if current_user.role == UserRole.EMPLOYEE:
        # An employee may ONLY create customers assigned to themselves.
        if (
            payload.assigned_employee_id is not None
            and payload.assigned_employee_id != current_user.id
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Employees can only create customers assigned to themselves.",
            )
        assigned_employee_id: Optional[uuid.UUID] = current_user.id
    else:
        # ADMIN / SUPER_ADMIN: may leave it unassigned (NULL) or assign it
        # to a valid, active EMPLOYEE.
        assigned_employee_id = payload.assigned_employee_id
        if assigned_employee_id is not None:
            try:
                validate_assignable_employee(db, assigned_employee_id)
            except ValueError as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=str(e),
                )

    if idempotency_key:
        existing = get_customer_by_idempotency_key(db, idempotency_key, current_user.id)
        if existing is not None:
            mismatch = existing.assigned_employee_id != assigned_employee_id or any(
                getattr(existing, f) != getattr(payload, f)
                for f in (
                    "full_name",
                    "mobile_number",
                    "aadhaar_number",
                    "pan_number",
                    "date_of_birth",
                    "alt_mobile_number",
                    "address_line_1",
                    "address_line_2",
                    "mandal_village",
                    "pincode",
                    "remarks",
                )
            )
            if mismatch:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "Idempotency-Key already used with a different "
                        "request payload."
                    ),
                )
            existing.assigned_employee_name = None
            return existing

    if get_customer_by_mobile(db, payload.mobile_number):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Mobile number already registered",
        )

    try:
        return create_customer(
            db=db,
            data=payload,
            created_by=current_user.id,
            assigned_employee_id=assigned_employee_id,
            idempotency_key=idempotency_key,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),  # duplicate aadhaar/pan surfaced from the DB
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
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Customer not assigned to you.",
        )

    return customer


# --------------------------------------------------
# UNMASK PII (Admin Only) — audited
# --------------------------------------------------
@router.get(
    "/{customer_id}/unmask",
    response_model=CustomerUnmaskedPII,
    summary="Get unmasked PII data (Admin Only)",
    dependencies=[Depends(no_store)],
)
def get_unmasked_pii(
    request: Request,
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # SECURITY: Admins only
):
    """Every unmask is recorded in audit_logs (NBFC compliance)."""
    customer = get_customer(db, customer_id)
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )

    write_audit(
        db,
        action_type="PII_UNMASK",
        target_table="customers",
        record_id=customer.id,
        user_id=current_user.id,
        new_data={"fields": ["aadhaar_number", "pan_number"]},
        request=request,
    )
    db.commit()

    return CustomerUnmaskedPII(
        aadhaar_number=customer.aadhaar_number, pan_number=customer.pan_number
    )


# --------------------------------------------------
# UPDATE
# --------------------------------------------------
@router.patch(
    "/{customer_id}",
    response_model=CustomerResponse,
    summary="Update customer details",
)
def update(
    request: Request,
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

    is_employee = current_user.role == UserRole.EMPLOYEE

    if is_employee and customer.assigned_employee_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Customer not assigned to you.",
        )

    sent = payload.model_dump(exclude_unset=True)

    # --- RBAC on assigned_employee_id (#2 / #3 / #7) ---
    if "assigned_employee_id" in sent:
        new_assignee = sent["assigned_employee_id"]
        if is_employee:
            # Employees may NOT reassign — not even to themselves explicitly
            # if it differs from the current owner.
            if new_assignee != current_user.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Employees cannot reassign customers.",
                )
        else:
            # ADMIN / SUPER_ADMIN: NULL clears assignment; non-NULL must be
            # a valid active EMPLOYEE.
            if new_assignee is not None:
                try:
                    validate_assignable_employee(db, new_assignee)
                except ValueError as e:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=str(e),
                    )

    try:
        return update_customer(
            db=db,
            customer=customer,
            data=payload,
            updated_by=current_user.id,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
@router.delete(
    "/{customer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft delete a customer",
)
def delete(
    request: Request,
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # Admin only
):
    customer = get_customer(db, customer_id)
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )
    try:
        soft_delete_customer(
            db=db, customer=customer, deleted_by=current_user.id, request=request
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
