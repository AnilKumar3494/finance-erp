import uuid
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import Request
from sqlalchemy import case, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.core.config import settings
from app.models.customer import Customer
from app.models.loan import Loan, LoanStatus
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.schemas.customer import CustomerCreate, CustomerUpdate
from app.utils.audit import write_audit
from app.utils.db_errors import safe_integrity_message
from app.utils.time import local_midnight, utcnow

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
        "branch_point",
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
    "branch_point",
    "address_line_1",
    "address_line_2",
    "mandal_village",
    "pincode",
)


_SORTABLE_COLUMNS: dict[str, Any] = {
    "full_name": Customer.full_name,
    "created_at": Customer.created_at,
    "assigned_employee_name": User.full_name,
}


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
    row = (
        db.query(Customer, User.full_name)
        .outerjoin(User, Customer.assigned_employee_id == User.id)
        .filter(Customer.id == customer_id, Customer.is_deleted == False)  # noqa: E712
        .first()
    )
    if row is None:
        return None
    customer, emp_name = row
    customer.assigned_employee_name = emp_name
    return customer


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
    created_after: Optional[date] = None,
    created_before: Optional[date] = None,
    page: int = 1,
    page_size: int = 20,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = None,
) -> tuple[list[Customer], int]:
    # Per-customer "primary" loan: ACTIVE wins over any other status; within a
    # group, the most-recently created wins. ROW_NUMBER + filter to rank=1.
    loan_rank = (
        db.query(
            Loan.id.label("loan_id"),
            Loan.customer_id.label("customer_id"),
            Loan.loan_number.label("loan_number"),
            Loan.vehicle_id.label("vehicle_id"),
            func.row_number()
            .over(
                partition_by=Loan.customer_id,
                order_by=[
                    case((Loan.status == LoanStatus.ACTIVE, 0), else_=1),
                    Loan.created_at.desc(),
                ],
            )
            .label("rn"),
        )
        .filter(Loan.is_deleted == False)  # noqa: E712
        .subquery()
    )
    primary_loan = aliased(loan_rank, name="primary_loan")

    query = (
        db.query(
            Customer,
            User.full_name,
            primary_loan.c.loan_number,
            Vehicle.plate_number,
        )
        .outerjoin(User, Customer.assigned_employee_id == User.id)
        .outerjoin(
            primary_loan,
            (primary_loan.c.customer_id == Customer.id)
            & (primary_loan.c.rn == 1),
        )
        .outerjoin(Vehicle, Vehicle.id == primary_loan.c.vehicle_id)
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

    # created_at is timestamptz, so bound it by local midnights rather than a
    # bare date (which Postgres reads as UTC midnight, losing the IST offset
    # window). `created_before` includes its whole day, hence `<` next midnight.
    tz = settings.REPORTS_TIMEZONE
    if created_after is not None:
        query = query.filter(Customer.created_at >= local_midnight(created_after, tz))
    if created_before is not None:
        query = query.filter(
            Customer.created_at < local_midnight(created_before + timedelta(days=1), tz)
        )

    # Sort. Unknown sort_by falls back to created_at desc so the response
    # is deterministic. Null placement is intentionally NOT pinned —
    # Postgres defaults are `ASC -> NULLS LAST` and `DESC -> NULLS FIRST`,
    # which gives the desired "click to flip Unassigned between top and
    # bottom" UX on the assigned_employee_name column. The other sortable
    # columns are NOT NULL so the default is a no-op for them. The id
    # tie-breaker keeps pagination stable when many rows share the same
    # sort key (common for assigned_employee_name).
    column = _SORTABLE_COLUMNS.get(sort_by or "", Customer.created_at)
    descending = (sort_order or "desc").lower() != "asc"
    ordering = column.desc() if descending else column.asc()
    query = query.order_by(ordering, Customer.id.asc())

    total = query.count()
    raw_results = query.offset((page - 1) * page_size).limit(page_size).all()

    results = []
    for customer, emp_name, loan_number, plate_number in raw_results:
        customer.assigned_employee_name = emp_name
        # Transient fields the response schema picks up via from_attributes.
        customer.primary_loan_number = loan_number
        customer.primary_vehicle_number = plate_number
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
        branch_point=data.branch_point,
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
        # Flush BEFORE the audit write so a unique-constraint violation
        # (duplicate mobile/aadhaar/pan) surfaces here as IntegrityError —
        # not later inside write_audit's SAVEPOINT, which would leave the
        # session in PendingRollbackError and our `except IntegrityError`
        # would never see it. Mirrors create_customer's ordering.
        db.flush()
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
