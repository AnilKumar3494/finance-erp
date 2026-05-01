import uuid
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.models.customer import Customer
from app.models.user import User
from app.schemas.customer import CustomerCreate, CustomerUpdate


def get_customer(db: Session, customer_id: uuid.UUID) -> Optional[Customer]:
    """Fetch single active customer by ID"""
    return (
        db.query(Customer)
        .filter(Customer.id == customer_id, Customer.is_deleted == False)
        .first()
    )


def get_customer_by_mobile(db: Session, mobile: str) -> Optional[Customer]:
    """Check for duplicate mobile on create"""
    return (
        db.query(Customer)
        .filter(Customer.mobile_number == mobile, Customer.is_deleted == False)
        .first()
    )


def list_customers(
    db: Session,
    search: Optional[str] = None,
    assigned_employee_id: Optional[uuid.UUID] = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Customer], int]:
    """
    List customers with optional search + filter.
    Returns (results, total_count)
    """
    query = (
        db.query(Customer, User.full_name)
        .outerjoin(User, Customer.assigned_employee_id == User.id)
        .filter(Customer.is_deleted == False)
    )

    # Search by name or mobile
    if search:
        query = query.filter(
            or_(
                Customer.full_name.ilike(f"%{search}%"),
                Customer.mobile_number.ilike(f"%{search}%"),
                User.full_name.ilike(f"%{search}%"),
            )
        )

    # Filter by assigned employee
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
    db: Session, data: CustomerCreate, created_by: uuid.UUID
) -> Customer:
    """Create a new customer"""
    customer = Customer(
        full_name=data.full_name,
        mobile_number=data.mobile_number,
        aadhaar_number=data.aadhaar_number,
        pan_number=data.pan_number,
        assigned_employee_id=data.assigned_employee_id,
        created_by_id=created_by,
    )
    db.add(customer)
    try:
        db.commit()
        db.refresh(customer)
        return get_customer(db, customer.id)
    except IntegrityError as e:
        db.rollback()
        raise ValueError(f"Duplicate value — {str(e.orig)}")


def update_customer(
    db: Session, customer: Customer, data: CustomerUpdate, updated_by: uuid.UUID
) -> Customer:
    """Update only the fields that were provided"""
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)

    customer.updated_by_id = updated_by
    db.commit()
    db.refresh(customer)
    return get_customer(db, customer.id)


def soft_delete_customer(
    db: Session, customer: Customer, deleted_by: uuid.UUID
) -> Customer:
    """Soft delete — never hard delete"""
    from datetime import datetime, timezone

    customer.is_deleted = True
    customer.deleted_at = datetime.now(timezone.utc)
    customer.updated_by_id = deleted_by
    db.commit()
    return customer
