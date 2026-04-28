import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.loan import Loan, LoanStatus
from app.models.transaction import Transaction, TransactionStatus
from app.schemas.transaction import TransactionCreate, TransactionUpdate
from app.services.loan import calculate_total_payable


# --------------------------------------------------
# QUERIES
# --------------------------------------------------
def get_transaction(db: Session, transaction_id: uuid.UUID) -> Optional[Transaction]:
    """Fetch single active transaction by ID"""
    return (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.is_deleted == False)
        .first()
    )


def list_transactions(
    db: Session,
    loan_id: Optional[uuid.UUID] = None,
    collected_by_id: Optional[uuid.UUID] = None,
    status: Optional[TransactionStatus] = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Transaction], int, Decimal]:
    """
    List transactions with filters.
    Returns (results, total_count, total_collected)
    """
    query = db.query(Transaction).filter(Transaction.is_deleted == False)

    if loan_id:
        query = query.filter(Transaction.loan_id == loan_id)

    if collected_by_id:
        query = query.filter(Transaction.collected_by_id == collected_by_id)

    if status:
        query = query.filter(Transaction.status == status)

    total = query.count()

    # Sum of all SUCCESS transactions in this filter
    total_collected = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.is_deleted == False,
            Transaction.status == TransactionStatus.SUCCESS,
            *([Transaction.loan_id == loan_id] if loan_id else []),
        )
        .scalar()
    )

    results = (
        query.order_by(Transaction.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return results, total, Decimal(str(total_collected))


def get_loan_transaction_summary(db: Session, loan: Loan) -> dict:
    """
    Calculate outstanding balance for a loan.
    total_payable - total_paid = outstanding
    """
    total_paid = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.loan_id == loan.id,
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted == False,
        )
        .scalar()
    )

    total_paid = Decimal(str(total_paid)).quantize(Decimal("0.01"))
    total_payable = calculate_total_payable(
        loan.principal, loan.interest_rate, loan.tenure
    )
    outstanding = max(total_payable - total_paid, Decimal("0.00"))

    return {
        "loan_id": loan.id,
        "principal": loan.principal,
        "total_payable": total_payable,
        "total_paid": total_paid,
        "outstanding": outstanding,
        "transaction_count": db.query(Transaction)
        .filter(Transaction.loan_id == loan.id, Transaction.is_deleted == False)
        .count(),
    }


def create_transaction(
    db: Session, data: TransactionCreate, created_by: uuid.UUID
) -> Transaction:
    """
    Record a payment against a loan.
    - Validates loan exists and is ACTIVE
    - Marks as PENDING by default
    """
    # Validate loan exists and is active
    loan = (
        db.query(Loan).filter(Loan.id == data.loan_id, Loan.is_deleted == False).first()
    )

    if not loan:
        raise ValueError("Loan not found")

    if loan.status != LoanStatus.ACTIVE:
        raise ValueError(f"Cannot record payment — loan is {loan.status.value}")

    # Prevent overpayment
    summary = get_loan_transaction_summary(db, loan)

    if data.amount > summary["outstanding"]:
        raise ValueError(
            f"Payment exceeds outstanding balance ({summary['outstanding']})"
        )

    transaction = Transaction(
        loan_id=data.loan_id,
        amount=data.amount,
        payment_mode=data.payment_mode,
        notes=data.notes,
        status=TransactionStatus.PENDING,
        collected_by_id=created_by,
        created_by_id=created_by,
    )
    db.add(transaction)
    try:
        db.commit()
        db.refresh(transaction)
        return transaction
    except IntegrityError:
        db.rollback()
        raise ValueError("Failed to record transaction")


def confirm_transaction(
    db: Session, transaction: Transaction, updated_by: uuid.UUID
) -> Transaction:
    """Mark a PENDING transaction as SUCCESS"""
    if transaction.status != TransactionStatus.PENDING:
        raise ValueError(f"Transaction is already {transaction.status.value}")
    transaction.status = TransactionStatus.SUCCESS
    transaction.updated_by_id = updated_by
    db.commit()
    db.refresh(transaction)
    return transaction


def update_transaction(
    db: Session,
    transaction: Transaction,
    data: TransactionUpdate,
    updated_by: uuid.UUID,
) -> Transaction:
    """Update transaction notes or status"""
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(transaction, field, value)
    transaction.updated_by_id = updated_by
    db.commit()
    db.refresh(transaction)
    return transaction


def soft_delete_transaction(
    db: Session, transaction: Transaction, deleted_by: uuid.UUID
) -> Transaction:
    from datetime import datetime, timezone

    transaction.is_deleted = True
    transaction.deleted_at = datetime.now(timezone.utc)
    transaction.updated_by_id = deleted_by
    db.commit()
    return transaction
