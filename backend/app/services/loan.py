import uuid
from decimal import Decimal
from typing import Optional
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.schemas.loan import LoanCreate, LoanUpdate
from app.models.loan import Loan, LoanStatus
from app.models.customer import Customer
from app.models.vehicle import Vehicle


# --------------------------------------------------
# CALCULATIONS
# --------------------------------------------------
def calculate_monthly_interest(principal: Decimal, rate: Decimal) -> Decimal:
    """Simple interest per month"""
    return round(((principal * rate) / 100) / 12, 2)


def calculate_total_payable(principal: Decimal, rate: Decimal, tenure: int) -> Decimal:
    """Total amount payable over tenure"""
    monthly = calculate_monthly_interest(principal, rate)
    return round(principal + (monthly * tenure), 2)


# --------------------------------------------------
# QUERIES
# --------------------------------------------------
def get_loan(db: Session, loan_id: uuid.UUID) -> Optional[Loan]:
    """Fetch single active loan by ID"""
    return db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()


def generate_loan_number() -> str:
    year = datetime.now(timezone.utc).year
    random_part = str(uuid.uuid4().int)[0:6]
    return f"LMS-{year}-{random_part}"


def get_active_loans_by_customer(db: Session, customer_id: uuid.UUID) -> list[Loan]:
    """Get all active loans for a customer"""
    return (
        db.query(Loan)
        .filter(
            Loan.customer_id == customer_id,
            Loan.status == LoanStatus.ACTIVE,
            Loan.is_deleted == False,
        )
        .all()
    )


def list_loans(
    db: Session,
    customer_id: Optional[uuid.UUID] = None,
    vehicle_id: Optional[uuid.UUID] = None,
    status: Optional[LoanStatus] = None,
    page: int = 1,
    page_size: int = 20,
    assigned_employee_id: Optional[uuid.UUID] = None,
) -> tuple[list[Loan], int]:
    """List loans with optional filters"""
    query = db.query(Loan).filter(Loan.is_deleted == False)

    if assigned_employee_id:
        query = query.join(Customer, Loan.customer_id == Customer.id).filter(
            Customer.assigned_employee_id == assigned_employee_id,
            Customer.is_deleted == False,
        )

    if customer_id:
        query = query.filter(Loan.customer_id == customer_id)

    if vehicle_id:
        query = query.filter(Loan.vehicle_id == vehicle_id)

    if status:
        query = query.filter(Loan.status == status)

    total = query.count()
    results = (
        query.order_by(Loan.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return results, total


def create_loan(db: Session, data: LoanCreate, created_by: uuid.UUID) -> Loan:
    """Create a new loan — validates customer and vehicle exist first"""
    # --------------------------------------------------
    # CHECK CUSTOMER EXISTS
    # --------------------------------------------------
    customer = (
        db.query(Customer)
        .filter(Customer.id == data.customer_id, Customer.is_deleted == False)
        .first()
    )
    if not customer:
        raise ValueError("Customer not found")

    # --------------------------------------------------
    # CHECK VEHICLE EXISTS (ONLY IF PROVIDED)
    # --------------------------------------------------
    if data.vehicle_id:
        vehicle = (
            db.query(Vehicle)
            .filter(Vehicle.id == data.vehicle_id, Vehicle.is_deleted == False)
            .first()
        )
        if not vehicle:
            raise ValueError("Vehicle not found")

    loan = Loan(
        loan_number=generate_loan_number(),
        customer_id=data.customer_id,
        vehicle_id=data.vehicle_id,
        principal=data.principal,
        interest_rate=data.interest_rate,
        tenure=data.tenure,
        status=LoanStatus.ACTIVE,
        created_by_id=created_by,
    )
    db.add(loan)
    try:
        db.commit()
        db.refresh(loan)
        return loan
    except IntegrityError as e:
        db.rollback()
        if "loans_loan_number_key" in str(e.orig):
            raise ValueError("Loan number collision — please retry")
        raise ValueError("Invalid customer or vehicle reference")


def update_loan(
    db: Session, loan: Loan, data: LoanUpdate, updated_by: uuid.UUID
) -> Loan:
    """Update loan — status, vehicle, rate, tenure only"""
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(loan, field, value)

    loan.updated_by_id = updated_by
    db.commit()
    db.refresh(loan)
    return loan


def close_loan(db: Session, loan: Loan, updated_by: uuid.UUID) -> Loan:
    """Mark loan as CLOSED"""

    from app.services.transaction import get_loan_transaction_summary

    summary = get_loan_transaction_summary(db, loan)

    if summary["outstanding"] > Decimal("0.00"):
        raise ValueError(
            f"Cannot close loan. Outstanding balance: {summary['outstanding']}"
        )

    loan.status = LoanStatus.CLOSED
    loan.updated_by_id = updated_by

    db.commit()
    db.refresh(loan)

    return loan


def mark_bad_debt(db: Session, loan: Loan, updated_by: uuid.UUID) -> Loan:
    """Mark loan as BAD_DEBT"""
    loan.status = LoanStatus.BAD_DEBT
    loan.updated_by_id = updated_by
    db.commit()
    db.refresh(loan)
    return loan


def soft_delete_loan(db: Session, loan: Loan, deleted_by: uuid.UUID) -> Loan:
    from datetime import datetime, timezone

    loan.is_deleted = True
    loan.deleted_at = datetime.now(timezone.utc)
    loan.updated_by_id = deleted_by
    db.commit()
    return loan
