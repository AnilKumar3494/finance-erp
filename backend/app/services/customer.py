"""
Customer service layer.

Every mutating call writes an audit_logs row before commit. Lookups intentionally
exclude soft-deleted rows; uniqueness checks against soft-deleted rows live in
the route layer (not done here) to keep this module side-effect-free for reads.
"""
import uuid
from typing import Optional

from fastapi import Request
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.customer import Customer
from app.models.user import User
from app.schemas.customer import CustomerCreate, CustomerUpdate
from app.utils.audit import write_audit
from app.utils.time import utcnow


# Fields safe to surface in audit logs (no raw PII like aadhaar/pan).
_AUDIT_SAFE_FIELDS = (
    "full_name",
    "mobile_number",
    "alt_mobile_number",
    "assigned_employee_id",
    "address_line_1",
    "address_line_2",
    "mandal_village",
    "date_of_birth",
)


def _audit_snapshot(customer: Customer) -> dict:
    return {f: getattr(customer, f, None) for f in _AUDIT_SAFE_FIELDS}


def get_customer(db: Session, customer_id: uuid.UUID) -> Optional[Customer]:
    """Fetch single active customer by ID."""
    return (
        db.query(Customer)
        .filter(Customer.id == customer_id, Customer.is_deleted == False)  # noqa: E712
        .first()
    )


def get_customer_by_mobile(db: Session, mobile: str) -> Optional[Customer]:
    """Check for duplicate mobile on create (active customers only)."""
    return (
        db.query(Customer)
        .filter(Customer.mobile_number == mobile, Customer.is_deleted == False)  # noqa: E712
        .first()
    )


def list_customers(
    db: Session,
    search: Optional[str] = None,
    assigned_employee_id: Optional[uuid.UUID] = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Customer], int]:
    """List customers with optional search + filter. Returns (results, total)."""
    query = (
        db.query(Customer, User.full_name)
        .outerjoin(User, Customer.assigned_employee_id == User.id)
        .filter(Customer.is_deleted == False)  # noqa: E712
    )

    if search:
        # Escape LIKE wildcards in user input so users can't accidentally
        # (or deliberately) probe the index with '%'/'_'.
        s = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(
            or_(
                Customer.full_name.ilike(f"%{s}%", escape="\\"),
                Customer.mobile_number.ilike(f"%{s}%", escape="\\"),
                User.full_name.ilike(f"%{s}%", escape="\\"),
            )
        )

    if assigned_employee_id:
        query = query.filter(Customer.assigned_employee_id == assigned_employee_id)

    total = query.count()
    raw_results = query.offset((page - 1) * page_size).limit(page_size).all()

    results = []
    for customer, emp_name in raw_results:
        customer.assigned_employee_name = emp_name
        results.append(customer)

    return results, total


def create_customer(
    db: Session,
    data: CustomerCreate,
    created_by: uuid.UUID,
    request: Optional[Request] = None,
) -> Customer:
    customer = Customer(
        full_name=data.full_name,
        mobile_number=data.mobile_number,
        aadhaar_number=data.aadhaar_number,
        pan_number=data.pan_number,
        assigned_employee_id=data.assigned_employee_id,
        date_of_birth=data.date_of_birth,
        alt_mobile_number=data.alt_mobile_number,
        address_line_1=data.address_line_1,
        address_line_2=data.address_line_2,
        mandal_village=data.mandal_village,
        remarks=data.remarks,
        created_by_id=created_by,
    )
    db.add(customer)
    try:
        db.flush()
        write_audit(
            db,
            action_type="CUSTOMER_CREATE",
            target_table="customers",
            record_id=customer.id,
            user_id=created_by,
            new_data=_audit_snapshot(customer),
            request=request,
        )
        db.commit()
        db.refresh(customer)
        return customer
    except IntegrityError as e:
        db.rollback()
        raise ValueError(f"Duplicate value — {str(e.orig)}")


def update_customer(
    db: Session,
    customer: Customer,
    data: CustomerUpdate,
    updated_by: uuid.UUID,
    request: Optional[Request] = None,
) -> Customer:
    """Update only the fields that were provided."""
    before = _audit_snapshot(customer)

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)

    customer.updated_by_id = updated_by

    write_audit(
        db,
        action_type="CUSTOMER_UPDATE",
        target_table="customers",
        record_id=customer.id,
        user_id=updated_by,
        old_data=before,
        new_data=_audit_snapshot(customer),
        request=request,
    )
    db.commit()
    db.refresh(customer)
    return customer


def soft_delete_customer(
    db: Session,
    customer: Customer,
    deleted_by: uuid.UUID,
    request: Optional[Request] = None,
) -> Customer:
    """Soft delete — never hard delete. Sets deleted_by_id correctly."""
    before = _audit_snapshot(customer)

    customer.is_deleted = True
    customer.deleted_at = utcnow()
    customer.deleted_by_id = deleted_by
    customer.updated_by_id = deleted_by

    write_audit(
        db,
        action_type="CUSTOMER_DELETE",
        target_table="customers",
        record_id=customer.id,
        user_id=deleted_by,
        old_data=before,
        request=request,
    )
    db.commit()
    return customer
