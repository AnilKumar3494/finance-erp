import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.customer import Customer
from app.models.due_cycle import DueCycle
from app.models.loan import Loan, LoanStatus
from app.models.transaction import (
    PunctualityStatus,
    Transaction,
    TransactionStatus,
)
from app.models.user import UserRole
from app.schemas.transaction import TransactionCreate, TransactionUpdate
from app.services.due_cycle import find_target_cycle_for_payment
from app.services.finance import total_payable as calc_total_payable


# --------------------------------------------------
# QUERIES
# --------------------------------------------------
def get_transaction(db: Session, transaction_id: uuid.UUID) -> Optional[Transaction]:
    """Fetch single active transaction by ID"""
    return (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.is_deleted.is_(False))
        .first()
    )


def list_transactions(
    db: Session,
    loan_id: Optional[uuid.UUID] = None,
    collected_by_id: Optional[uuid.UUID] = None,
    status: Optional[TransactionStatus] = None,
    page: int = 1,
    page_size: int = 20,
    current_user_id: Optional[uuid.UUID] = None,
    current_user_role: Optional[UserRole] = None,
) -> tuple[list[Transaction], int, Decimal]:
    """
    List transactions with filters.
    Returns (results, total_count, total_collected)
    EMPLOYEE users only see transactions for their assigned customers.
    """
    query = db.query(Transaction).filter(Transaction.is_deleted.is_(False))

    ##AKTODO: Make this a resuale util later
    if current_user_role == UserRole.EMPLOYEE:
        query = (
            query.join(Loan, Transaction.loan_id == Loan.id)
            .join(Customer, Loan.customer_id == Customer.id)
            .filter(
                Customer.assigned_employee_id == current_user_id,
                Customer.is_deleted.is_(False),
            )
        )

    if loan_id:
        query = query.filter(Transaction.loan_id == loan_id)

    if collected_by_id:
        query = query.filter(Transaction.collected_by_id == collected_by_id)

    if status:
        query = query.filter(Transaction.status == status)

    total = query.count()

    # Sum of all SUCCESS transactions in this filter
    total_collected = (
        query.with_entities(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(Transaction.status == TransactionStatus.SUCCESS)
        .scalar()
    )

    results = (
        query.with_entities(Transaction)
        .order_by(Transaction.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return results, total, Decimal(str(total_collected))


def get_loan_transaction_summary(db: Session, loan: Loan) -> dict:
    """
    Calculate outstanding balance for a loan.
    total_payable - total_paid = outstanding
    Also returns total_pending for visibility.
    """
    total_paid = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.loan_id == loan.id,
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted.is_(False),
        )
        .scalar()
    )

    total_pending = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.loan_id == loan.id,
            Transaction.status == TransactionStatus.PENDING,
            Transaction.is_deleted.is_(False),
        )
        .scalar()
    )

    total_paid = Decimal(str(total_paid)).quantize(Decimal("0.01"))
    total_pending = Decimal(str(total_pending)).quantize(Decimal("0.01"))

    # base_total_payable = original schedule's total.
    # Active penalty events from late-payment classifications add on top.
    # Local import keeps the loan ↔ penalty ↔ transaction module load order safe.
    from app.services.penalty import sum_active_penalties_for_loan

    base_total_payable = calc_total_payable(
        loan.principal, loan.interest_rate, loan.tenure
    )
    active_penalty = sum_active_penalties_for_loan(db, loan.id)
    total_payable = (base_total_payable + active_penalty).quantize(Decimal("0.01"))
    outstanding = max(total_payable - total_paid, Decimal("0.00"))

    return {
        "loan_id": loan.id,
        "principal": loan.principal,
        "total_payable": total_payable,
        "total_paid": total_paid,
        "total_pending": total_pending,
        "outstanding": outstanding,
        "transaction_count": db.query(Transaction)
        .filter(Transaction.loan_id == loan.id, Transaction.is_deleted.is_(False))
        .count(),
    }


# --------------------------------------------------
# CYCLE TOTALS HELPER
# --------------------------------------------------
def recompute_cycle_totals(db: Session, cycle: DueCycle) -> None:
    """
    Recompute cycle.total_received from the active SUCCESS transactions
    currently allocated to this cycle.

    Call this whenever a transaction's status, amount, or due_cycle_id
    changes in a way that affects this cycle.
    """
    total = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.due_cycle_id == cycle.id,
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted.is_(False),
        )
        .scalar()
    )
    cycle.total_received = Decimal(str(total))


def resolve_due_cycle_for_payment(
    db: Session,
    loan: Loan,
    effective_payment_date: date,
    override_cycle_id: Optional[uuid.UUID],
) -> Optional[DueCycle]:
    """
    Decide which due-cycle a payment goes to.

    Order of precedence:
      1. Admin override — `override_cycle_id` must belong to this loan and not be deleted.
      2. Default rule — earliest cycle whose due_date >= effective_payment_date.
         If all due dates have passed, allocate to the last cycle.

    Returns the DueCycle row, or None if the loan has no cycles (e.g.
    legacy data — caller should treat as "unallocated").
    """
    if override_cycle_id is not None:
        cycle = (
            db.query(DueCycle)
            .filter(
                DueCycle.id == override_cycle_id,
                DueCycle.loan_id == loan.id,
                DueCycle.is_deleted.is_(False),
            )
            .first()
        )
        if cycle is None:
            raise ValueError(
                "due_cycle_id does not belong to this loan or is deleted"
            )
        return cycle

    return find_target_cycle_for_payment(db, loan.id, effective_payment_date)


# --------------------------------------------------
# CREATE
# --------------------------------------------------
def create_transaction(
    db: Session, data: TransactionCreate, created_by: uuid.UUID
) -> Transaction:
    """
    Record a payment against a loan.
    - Validates loan exists and is ACTIVE
    - Locks loan row to prevent concurrent overpayment
    - Counts PENDING toward reserved amount
    - Supports idempotency_key to prevent duplicates
    - Allocates to a due-cycle based on effective_payment_date (or admin override)
    """
    # --- Idempotency check ---
    if data.idempotency_key:
        existing = (
            db.query(Transaction)
            .filter(
                Transaction.idempotency_key == data.idempotency_key,
                Transaction.is_deleted.is_(False),
            )
            .first()
        )
        if existing:
            return existing

    # --- Lock loan row to prevent race conditions ---
    loan = (
        db.query(Loan)
        .filter(Loan.id == data.loan_id, Loan.is_deleted.is_(False))
        .with_for_update()
        .first()
    )

    if not loan:
        raise ValueError("Loan not found")

    if loan.status != LoanStatus.ACTIVE:
        raise ValueError(f"Cannot record payment — loan is {loan.status.value}")

    # --- Overpayment check (includes PENDING as reserved) ---
    summary = get_loan_transaction_summary(db, loan)
    effective_outstanding = summary["outstanding"] - summary["total_pending"]

    if data.amount > effective_outstanding:
        raise ValueError(
            f"Payment of {data.amount} exceeds available balance "
            f"({effective_outstanding}). Outstanding: {summary['outstanding']}, "
            f"Pending: {summary['total_pending']}"
        )

    # --- Resolve effective date and target due-cycle ---
    eff_date = data.effective_payment_date or date.today()
    target_cycle = resolve_due_cycle_for_payment(
        db=db,
        loan=loan,
        effective_payment_date=eff_date,
        override_cycle_id=data.due_cycle_id,
    )

    transaction = Transaction(
        loan_id=data.loan_id,
        amount=data.amount,
        payment_mode=data.payment_mode,
        notes=data.notes,
        status=TransactionStatus.PENDING,
        collected_by_id=data.collected_by_id or created_by,
        created_by_id=created_by,
        idempotency_key=data.idempotency_key,
        effective_payment_date=eff_date,
        punctuality_status=PunctualityStatus.AWAITING_REVIEW,
        due_cycle_id=target_cycle.id if target_cycle else None,
    )
    db.add(transaction)
    try:
        db.commit()
        db.refresh(transaction)
        # PENDING transactions don't change cycle.total_received yet — that
        # happens at admin confirmation in step 5.
        return transaction
    except IntegrityError as e:
        db.rollback()
        # Idempotency key collision from concurrent request
        if "idempotency_key" in str(e.orig):
            existing = (
                db.query(Transaction)
                .filter(Transaction.idempotency_key == data.idempotency_key)
                .first()
            )
            if existing:
                return existing
        raise ValueError("Failed to record transaction")


# --------------------------------------------------
# CONFIRM
# --------------------------------------------------
def confirm_transaction(
    db: Session, transaction: Transaction, updated_by: uuid.UUID
) -> Transaction:
    """
    Mark a PENDING transaction as SUCCESS.
    Re-validates outstanding with a loan lock to prevent overpayment on confirm.
    """
    if transaction.status != TransactionStatus.PENDING:
        raise ValueError(f"Transaction is already {transaction.status.value}")

    # --- Lock loan and re-validate outstanding ---
    loan = (
        db.query(Loan).filter(Loan.id == transaction.loan_id).with_for_update().first()
    )

    if loan.status != LoanStatus.ACTIVE:
        raise ValueError(f"Cannot confirm — loan is {loan.status.value}")

    summary = get_loan_transaction_summary(db, loan)

    # After confirming, total_paid would increase by this amount
    new_total_paid = summary["total_paid"] + transaction.amount
    if new_total_paid > summary["total_payable"]:
        raise ValueError(
            f"Confirming this would exceed total payable. "
            f"Total payable: {summary['total_payable']}, "
            f"Would become: {new_total_paid}"
        )

    transaction.status = TransactionStatus.SUCCESS
    transaction.updated_by_id = updated_by

    # Keep the allocated cycle's running total in sync.
    # autoflush is OFF on this session, so explicitly flush the status
    # change before the recompute query reads it.
    if transaction.due_cycle_id is not None:
        db.flush()
        cycle = (
            db.query(DueCycle)
            .filter(DueCycle.id == transaction.due_cycle_id)
            .with_for_update()
            .first()
        )
        if cycle is not None:
            recompute_cycle_totals(db, cycle)

    db.commit()
    db.refresh(transaction)

    # --- Auto-close loan if fully paid ---
    # NOTE: step 7 replaces this with AWAITING_CLOSURE + manual admin close.
    refreshed_summary = get_loan_transaction_summary(db, loan)
    if refreshed_summary["outstanding"] <= Decimal("0.00"):
        loan.status = LoanStatus.CLOSED
        loan.updated_by_id = updated_by
        db.commit()
        db.refresh(loan)

    return transaction


# --------------------------------------------------
# FAIL
# --------------------------------------------------
def fail_transaction(
    db: Session,
    transaction: Transaction,
    updated_by: uuid.UUID,
    reason: Optional[str] = None,
) -> Transaction:
    """Mark a PENDING transaction as FAILED (e.g. bounced cheque, failed UPI)"""
    if transaction.status != TransactionStatus.PENDING:
        raise ValueError(f"Transaction is already {transaction.status.value}")

    transaction.status = TransactionStatus.FAILED
    transaction.updated_by_id = updated_by
    if reason:
        transaction.notes = f"{transaction.notes or ''} | FAILED: {reason}".strip(" |")
    db.commit()
    db.refresh(transaction)
    return transaction


# --------------------------------------------------
# UPDATE
# --------------------------------------------------
def update_transaction(
    db: Session,
    transaction: Transaction,
    data: TransactionUpdate,
    updated_by: uuid.UUID,
) -> Transaction:
    """Update transaction notes only. Status changes go through /confirm or /fail."""
    if transaction.status == TransactionStatus.SUCCESS:
        raise ValueError("Cannot modify a confirmed transaction")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(transaction, field, value)
    transaction.updated_by_id = updated_by
    db.commit()
    db.refresh(transaction)
    return transaction


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
def soft_delete_transaction(
    db: Session, transaction: Transaction, deleted_by: uuid.UUID
) -> Transaction:
    """Soft delete — only allowed for FAILED transactions."""
    if transaction.status == TransactionStatus.SUCCESS:
        raise ValueError(
            "Cannot delete a confirmed transaction. "
            "Contact super admin for reversal."
        )

    if transaction.status == TransactionStatus.PENDING:
        raise ValueError(
            "Cannot delete a pending transaction. "
            "Mark it as failed first, then delete."
        )

    transaction.is_deleted = True
    transaction.deleted_at = datetime.now(timezone.utc)
    transaction.updated_by_id = deleted_by
    db.commit()
    return transaction
