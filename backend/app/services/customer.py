import uuid
from typing import Optional

from fastapi import Request
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.customer import Customer
from app.models.loan import Loan, LoanStatus
from app.models.user import User, UserRole
from app.schemas.customer import CustomerCreate, CustomerUpdate
from app.utils.audit import write_audit
from app.utils.db_errors import safe_integrity_message
from app.utils.time import utcnow


_IDEMPOTENCY_COMPARE_FIELDS = (
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


def _request_matches_customer(
    existing: Customer,
    data: CustomerCreate,
    assigned_employee_id: Optional[uuid.UUID],
) -> bool:
    """True only if `existing` was created from this exact request payload."""
    if existing.assigned_employee_id != assigned_employee_id:
        return False
    return all(
        getattr(existing, f) == getattr(data, f) for f in _IDEMPOTENCY_COMPARE_FIELDS
    )


_MUTABLE_FIELDS = frozenset(
    {
        "full_name",
        "mobile_number",
        "aadhaar_number",
        "pan_number",
        "assigned_employee_id",
        "date_of_birth",
        "alt_mobile_number",
        "address_line_1",
        "address_line_2",
        "mandal_village",
        "pincode",
        "remarks",
    }
)

_AUDIT_SAFE_FIELDS = (
    "full_name",
    "mobile_number",
    "alt_mobile_number",
    "assigned_employee_id",
    "address_line_1",
    "address_line_2",
    "mandal_village",
    "pincode",
)


def _audit_snapshot(customer: Customer) -> dict:
    return {f: getattr(customer, f, None) for f in _AUDIT_SAFE_FIELDS}


# --------------------------------------------------
# VALIDATION HELPERS
# --------------------------------------------------
def validate_assignable_employee(db: Session, user_id: uuid.UUID) -> None:
    """
    #7 — A customer may only be assigned to a user who is an active,
    non-deleted EMPLOYEE. Raises ValueError otherwise (route → 422).
    """
    target = (
        db.query(User)
        .filter(
            User.id == user_id,
            User.is_active == True,  # noqa: E712
            User.is_deleted == False,  # noqa: E712
        )
        .first()
    )
    if target is None:
        raise ValueError("Assigned employee not found or inactive")
    if target.role != UserRole.EMPLOYEE:
        raise ValueError("Customers can only be assigned to an EMPLOYEE")


def _customer_has_active_loan(db: Session, customer_id: uuid.UUID) -> bool:
    return (
        db.query(Loan.id)
        .filter(
            Loan.customer_id == customer_id,
            Loan.status == LoanStatus.ACTIVE,
            Loan.is_deleted == False,  # noqa: E712
        )
        .first()
        is not None
    )


# --------------------------------------------------
# READS
# --------------------------------------------------
def get_customer(db: Session, customer_id: uuid.UUID) -> Optional[Customer]:
    return (
        db.query(Customer)
        .filter(Customer.id == customer_id, Customer.is_deleted == False)  # noqa: E712
        .first()
    )


def get_customer_by_mobile(db: Session, mobile: str) -> Optional[Customer]:
    return (
        db.query(Customer)
        .filter(
            Customer.mobile_number == mobile, Customer.is_deleted == False
        )  # noqa: E712
        .first()
    )


def get_customer_by_idempotency_key(
    db: Session, key: str, created_by: uuid.UUID
) -> Optional[Customer]:
    return (
        db.query(Customer)
        .filter(
            Customer.idempotency_key == key,
            Customer.created_by_id == created_by,
            Customer.is_deleted == False,  # noqa: E712
        )
        .first()
    )


def list_customers(
    db: Session,
    search: Optional[str] = None,
    assigned_employee_id: Optional[uuid.UUID] = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Customer], int]:
    query = (
        db.query(Customer, User.full_name)
        .outerjoin(User, Customer.assigned_employee_id == User.id)
        .filter(Customer.is_deleted == False)  # noqa: E712
    )

    if search:
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


# --------------------------------------------------
# CREATE
# --------------------------------------------------
def create_customer(
    db: Session,
    data: CustomerCreate,
    created_by: uuid.UUID,
    *,
    assigned_employee_id: Optional[uuid.UUID],
    idempotency_key: Optional[str] = None,
    request: Optional[Request] = None,
) -> Customer:
    """
    Create a customer.
    """
    if assigned_employee_id is not None:
        validate_assignable_employee(db, assigned_employee_id)

    customer = Customer(
        full_name=data.full_name,
        mobile_number=data.mobile_number,
        aadhaar_number=data.aadhaar_number,
        pan_number=data.pan_number,
        assigned_employee_id=assigned_employee_id,
        date_of_birth=data.date_of_birth,
        alt_mobile_number=data.alt_mobile_number,
        address_line_1=data.address_line_1,
        address_line_2=data.address_line_2,
        mandal_village=data.mandal_village,
        pincode=data.pincode,
        remarks=data.remarks,
        idempotency_key=idempotency_key,
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
        if idempotency_key:
            existing = get_customer_by_idempotency_key(db, idempotency_key, created_by)
            if existing is not None:
                if _request_matches_customer(existing, data, assigned_employee_id):
                    return existing
                raise ValueError(
                    "Idempotency-Key already used with a different request payload."
                ) from None
        # Unrelated unique violation (mobile/aadhaar/pan) — generic, non-leaking.
        raise ValueError(safe_integrity_message(e)) from None


# --------------------------------------------------
# UPDATE
# --------------------------------------------------
def update_customer(
    db: Session,
    customer: Customer,
    data: CustomerUpdate,
    updated_by: uuid.UUID,
    request: Optional[Request] = None,
) -> Customer:
    """
    Apply only supplied fields. Mass-assignment is constrained to
    _MUTABLE_FIELDS (#3). assigned_employee_id RBAC is done in the route.
    """
    changes = data.model_dump(exclude_unset=True)

    illegal = set(changes) - _MUTABLE_FIELDS
    if illegal:
        raise ValueError(f"Fields not allowed: {sorted(illegal)}")

    if changes.get("assigned_employee_id") is not None:
        validate_assignable_employee(db, changes["assigned_employee_id"])

    before = _audit_snapshot(customer)

    for field, value in changes.items():
        setattr(customer, field, value)

    customer.updated_by_id = updated_by

    try:
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
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e)) from None


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
def soft_delete_customer(
    db: Session,
    customer: Customer,
    deleted_by: uuid.UUID,
    request: Optional[Request] = None,
) -> Customer:
    """
    Block soft-delete while the customer has any ACTIVE loan.
    """
    if _customer_has_active_loan(db, customer.id):
        raise ValueError(
            "Cannot delete a customer with an active loan. "
            "Close or settle the loan first."
        )

    before = _audit_snapshot(customer)
    customer.soft_delete(deleted_by)

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
