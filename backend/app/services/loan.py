import uuid
from decimal import Decimal
from typing import Optional
from datetime import date, datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.schemas.loan import LoanCreate, LoanUpdate
from app.models.loan import Loan, LoanStatus
from app.models.customer import Customer
from app.models.vehicle import Vehicle
from app.models.transaction import (
    PunctualityStatus,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.services.due_cycle import generate_cycles_for_loan
from app.services.finance import monthly_interest, total_payable as calc_total_payable


# --------------------------------------------------
# VALID INCLUDE OPTIONS
# --------------------------------------------------
VALID_INCLUDES = {"customer", "vehicle", "created_by", "updated_by"}


def parse_includes(include: Optional[str]) -> set[str]:
    """Parse and validate comma-separated include string"""
    if not include:
        return set()
    requested = {s.strip().lower() for s in include.split(",")}
    return requested & VALID_INCLUDES


def _apply_eager_loading(query, includes: set[str]):
    """Apply joinedload for requested relationships"""
    if "customer" in includes:
        query = query.options(joinedload(Loan.customer))
    if "vehicle" in includes:
        query = query.options(joinedload(Loan.vehicle))
    if "created_by" in includes:
        query = query.options(joinedload(Loan.created_by))
    if "updated_by" in includes:
        query = query.options(joinedload(Loan.updated_by))
    return query


# --------------------------------------------------
# CALCULATIONS
# Thin wrappers around the canonical finance helpers so existing callers
# (routes, transaction service) keep working without import churn.
# --------------------------------------------------
def calculate_monthly_interest(principal: Decimal, rate: Decimal) -> Decimal:
    """Simple flat interest per month (banker's rounding to paise)."""
    return monthly_interest(principal, rate)


def calculate_total_payable(principal: Decimal, rate: Decimal, tenure: int) -> Decimal:
    """Principal + (monthly_interest * tenure) — both quantised to paise."""
    return calc_total_payable(principal, rate, tenure)


# --------------------------------------------------
# QUERIES
# --------------------------------------------------
def get_loan(
    db: Session, loan_id: uuid.UUID, include: Optional[str] = None
) -> Optional[Loan]:
    """Fetch single active loan by ID"""
    includes = parse_includes(include)
    query = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False)
    query = _apply_eager_loading(query, includes)
    return query.first()


def generate_loan_number() -> str:
    year = datetime.now(timezone.utc).year
    random_part = str(uuid.uuid4().int)[0:6]
    return f"LMS-{year}-{random_part}"


def get_active_loans_by_customer(
    db: Session, customer_id: uuid.UUID, include: Optional[str] = None
) -> list[Loan]:
    """Get all active loans for a customer"""
    includes = parse_includes(include)
    query = db.query(Loan).filter(
        Loan.customer_id == customer_id,
        Loan.status == LoanStatus.ACTIVE,
        Loan.is_deleted == False,
    )
    query = _apply_eager_loading(query, includes)
    return query.all()


def list_loans(
    db: Session,
    customer_id: Optional[uuid.UUID] = None,
    vehicle_id: Optional[uuid.UUID] = None,
    status: Optional[LoanStatus] = None,
    page: int = 1,
    page_size: int = 20,
    assigned_employee_id: Optional[uuid.UUID] = None,
    include: Optional[str] = None,
) -> tuple[list[Loan], int]:
    """List loans with optional filters and eager loading"""
    includes = parse_includes(include)
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

    query = _apply_eager_loading(query, includes)

    results = (
        query.order_by(Loan.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return results, total


def create_loan(db: Session, data: LoanCreate, created_by: uuid.UUID) -> Loan:
    """
    Create a new loan in DRAFT state.

    DRAFT loans:
      - Have no due cycles yet (generated at approval).
      - Have no down-payment transaction yet (created at approval).
      - Carry no approval_date / due_day_of_month yet.

    The dedicated `approve_loan` step transitions DRAFT → ACTIVE and
    produces the schedule + DP transaction atomically.
    """
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

    # --------------------------------------------------
    # GUARD: down payment cannot meet or exceed principal
    # (review item — produces negative net values otherwise)
    # --------------------------------------------------
    if data.down_payment is not None and data.down_payment >= data.principal:
        raise ValueError(
            "Down payment must be strictly less than principal"
        )

    loan = Loan(
        loan_number=generate_loan_number(),
        customer_id=data.customer_id,
        vehicle_id=data.vehicle_id,
        principal=data.principal,
        interest_rate=data.interest_rate,
        tenure=data.tenure,
        down_payment=data.down_payment,
        processing_fee=data.processing_fee,
        documentation_fee=data.documentation_fee,
        # penalty_rate defaults to 36.00 from the DB; admin can override via update.
        status=LoanStatus.DRAFT,
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


def approve_loan(
    db: Session,
    loan: Loan,
    approved_by: uuid.UUID,
    down_payment_mode: Optional[str] = None,
) -> Loan:
    """
    Transition a DRAFT loan to ACTIVE.

    Atomically:
      - Stamps approval_date = today, due_day_of_month = today.day.
      - Generates 1..tenure DueCycle rows with the agreed last-day-of-month
        fallback for short months.
      - If the loan has a down payment, creates a DOWN_PAYMENT transaction
        with status=SUCCESS, punctuality=PAID_ON_TIME, effective_date=today,
        allocated to cycle 1 (which is automatically "ahead" by the DP amount).

    Raises:
      ValueError if loan is not in DRAFT or if down payment is set but
      `down_payment_mode` is missing.
    """
    if loan.status != LoanStatus.DRAFT:
        raise ValueError(
            f"Only DRAFT loans can be approved; this loan is {loan.status.value}"
        )

    if loan.down_payment and loan.down_payment > 0 and not down_payment_mode:
        raise ValueError("down_payment_mode is required when down_payment > 0")

    today = date.today()
    loan.approval_date = today
    loan.due_day_of_month = today.day
    loan.status = LoanStatus.ACTIVE
    loan.updated_by_id = approved_by

    # Generate due cycles (cycles are added to session, not yet committed).
    cycles = generate_cycles_for_loan(db, loan, approved_by=approved_by)

    # Flush so the cycles have IDs we can reference in the DP transaction.
    db.flush()

    if loan.down_payment and loan.down_payment > 0:
        first_cycle = cycles[0] if cycles else None
        db.add(
            Transaction(
                loan_id=loan.id,
                amount=loan.down_payment,
                payment_mode=down_payment_mode,
                transaction_type=TransactionType.DOWN_PAYMENT,
                status=TransactionStatus.SUCCESS,
                punctuality_status=PunctualityStatus.PAID_ON_TIME,
                effective_payment_date=today,
                due_cycle_id=first_cycle.id if first_cycle else None,
                collected_by_id=approved_by,
                created_by_id=approved_by,
            )
        )
        # The DP is a SUCCESS payment that lands on cycle 1 (or rolls forward
        # as credit). Keep the cycle's running total in sync from the start.
        if first_cycle is not None:
            db.flush()
            # Local import avoids loan ↔ transaction circular import at module load.
            from app.services.transaction import recompute_cycle_totals

            recompute_cycle_totals(db, first_cycle)

    db.commit()
    db.refresh(loan)
    return loan


def update_loan(
    db: Session, loan: Loan, data: LoanUpdate, updated_by: uuid.UUID
) -> Loan:
    """
    Update a loan. Defense-in-depth: the service refuses edits on loans that
    are not in DRAFT or ACTIVE — even if a caller skips the route's guard
    (review items L1/L2). Approval-date is never settable here.
    """
    if loan.status not in (LoanStatus.DRAFT, LoanStatus.ACTIVE):
        raise ValueError(
            f"Loan in status {loan.status.value} is immutable. "
            "Edits are only permitted in DRAFT or ACTIVE."
        )

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(loan, field, value)

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
    # Use AuditBase.soft_delete so deleted_by_id is also set (review item L3).
    loan.soft_delete(deleted_by)
    db.commit()
    return loan
