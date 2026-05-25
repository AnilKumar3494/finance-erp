import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.access import assert_loan_access
from app.dependencies.auth import get_current_user, require_admin
from app.models.loan import Loan
from app.models.transaction import Transaction, TransactionStatus
from app.models.user import User
from app.schemas.transaction import (
    LoanTransactionSummary,
    TransactionCreate,
    TransactionListResponse,
    TransactionResponse,
    TransactionUpdate,
)
from app.services.loan import get_loan
from app.services.transaction import (
    confirm_transaction,
    create_transaction,
    fail_transaction,
    get_loan_transaction_summary,
    get_transaction,
    list_transactions,
    soft_delete_transaction,
    update_transaction,
)
from app.utils.audit import write_audit

router = APIRouter(prefix="/transactions", tags=["Transactions"])


# --------------------------------------------------
# RBAC helpers — wrap the centralized access dep so existing call sites
# keep their familiar signatures (loan_id / transaction). The actual
# rule (ADMIN sees all; EMPLOYEE only assigned-customer loans) lives in
# app/dependencies/access.py.
# --------------------------------------------------
def _assert_loan_in_user_scope(
    db: Session, loan_id: uuid.UUID, current_user: User
) -> Loan:
    loan = (
        db.query(Loan)
        .filter(Loan.id == loan_id, Loan.is_deleted.is_(False))
        .first()
    )
    if loan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )
    assert_loan_access(loan, current_user, db)
    return loan


def _assert_transaction_in_user_scope(
    db: Session, transaction: Transaction, current_user: User
) -> None:
    """Block employees from reading/touching transactions outside their scope."""
    _assert_loan_in_user_scope(db, transaction.loan_id, current_user)


# --------------------------------------------------
# AUDIT — central helper so every money-touching path here records the
# same shape. Per the code-style note we never log raw PII; for
# transactions the sensitive number is `amount`, which IS something
# auditors will want to see — that's fine, it's a money record. We omit
# `notes` because admins use it as a free-text channel that can include
# customer-supplied strings.
# --------------------------------------------------
def _txn_audit_snapshot(t: Transaction) -> dict:
    return {
        "loan_id": str(t.loan_id),
        "amount": str(t.amount),
        "payment_mode": t.payment_mode.value if t.payment_mode else None,
        "status": t.status.value,
        "transaction_type": t.transaction_type.value,
        "punctuality_status": t.punctuality_status.value,
        "effective_payment_date": (
            t.effective_payment_date.isoformat() if t.effective_payment_date else None
        ),
        "due_cycle_id": str(t.due_cycle_id) if t.due_cycle_id else None,
        "collected_by_id": str(t.collected_by_id) if t.collected_by_id else None,
    }


# --------------------------------------------------
# CREATE
# --------------------------------------------------
@router.post(
    "/",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a new payment",
)
def create_transaction_route(
    request: Request,
    payload: TransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # T1 fix: employees can only create transactions for their assigned customers' loans.
    _assert_loan_in_user_scope(db, payload.loan_id, current_user)
    try:
        txn = create_transaction(db=db, data=payload, created_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # The create_transaction service short-circuits on idempotency hit and
    # returns the pre-existing row. Audit anyway — the row's history will
    # show one CREATE and zero duplicates, which is the truth.
    write_audit(
        db,
        action_type="TRANSACTION_CREATE",
        target_table="transactions",
        record_id=txn.id,
        user_id=current_user.id,
        new_data=_txn_audit_snapshot(txn),
        request=request,
    )
    db.commit()
    return txn


# --------------------------------------------------
# LIST
# --------------------------------------------------
@router.get(
    "/",
    response_model=TransactionListResponse,
    summary="List transactions with filters",
)
def list_all(
    loan_id: Optional[uuid.UUID] = Query(None),
    collected_by_id: Optional[uuid.UUID] = Query(None),
    status_filter: Optional[TransactionStatus] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    results, total, total_collected = list_transactions(
        db=db,
        loan_id=loan_id,
        collected_by_id=collected_by_id,
        status=status_filter,
        page=page,
        page_size=page_size,
        current_user_id=current_user.id,
        current_user_role=current_user.role,
    )
    return TransactionListResponse(
        total=total,
        page=page,
        page_size=page_size,
        total_collected=total_collected,
        results=results,
    )


# --------------------------------------------------
# GET BY ID
# --------------------------------------------------
@router.get(
    "/{transaction_id}",
    response_model=TransactionResponse,
    summary="Get a single transaction",
)
def get_one(
    transaction_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    transaction = get_transaction(db, transaction_id)
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found"
        )
    # T1 fix: 403 for employees reading transactions outside their scope.
    _assert_transaction_in_user_scope(db, transaction, current_user)
    return transaction


# --------------------------------------------------
# LOAN SUMMARY
# --------------------------------------------------
@router.get(
    "/loan/{loan_id}/summary",
    response_model=LoanTransactionSummary,
    summary="Get outstanding balance for a loan",
)
def loan_summary(
    loan_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # T1 fix: 403 for employees reading summaries outside their scope.
    loan = _assert_loan_in_user_scope(db, loan_id, current_user)
    return get_loan_transaction_summary(db, loan)


# --------------------------------------------------
# CONFIRM TRANSACTION (Admin only)
# --------------------------------------------------
@router.post(
    "/{transaction_id}/confirm",
    response_model=TransactionResponse,
    summary="Confirm a pending transaction",
)
def confirm_transaction_route(
    request: Request,
    transaction_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    transaction = get_transaction(db, transaction_id)
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found"
        )

    before = _txn_audit_snapshot(transaction)
    try:
        updated = confirm_transaction(
            db=db, transaction=transaction, updated_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    write_audit(
        db,
        action_type="TRANSACTION_CONFIRM",
        target_table="transactions",
        record_id=updated.id,
        user_id=current_user.id,
        old_data=before,
        new_data=_txn_audit_snapshot(updated),
        request=request,
    )
    db.commit()
    return updated


# --------------------------------------------------
# FAIL TRANSACTION (Admin only)
# --------------------------------------------------
@router.post(
    "/{transaction_id}/fail",
    response_model=TransactionResponse,
    summary="Mark a pending transaction as failed",
)
def fail_transaction_route(
    request: Request,
    transaction_id: uuid.UUID,
    reason: Optional[str] = Query(None, max_length=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    transaction = get_transaction(db, transaction_id)
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found"
        )

    before = _txn_audit_snapshot(transaction)
    try:
        updated = fail_transaction(
            db=db, transaction=transaction, updated_by=current_user.id, reason=reason
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    write_audit(
        db,
        action_type="TRANSACTION_FAIL",
        target_table="transactions",
        record_id=updated.id,
        user_id=current_user.id,
        old_data=before,
        new_data={
            **_txn_audit_snapshot(updated),
            "fail_reason_provided": reason is not None,
        },
        request=request,
    )
    db.commit()
    return updated


# --------------------------------------------------
# UPDATE (Admin only)
# --------------------------------------------------
@router.patch(
    "/{transaction_id}",
    response_model=TransactionResponse,
    summary="Update transaction notes",
)
def update_transaction_route(
    request: Request,
    transaction_id: uuid.UUID,
    payload: TransactionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    transaction = get_transaction(db, transaction_id)
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found"
        )

    before = {"had_notes": transaction.notes is not None}
    try:
        updated = update_transaction(
            db=db, transaction=transaction, data=payload, updated_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Notes are the only mutable field today. Audit the fact that an edit
    # happened — never the content, since admins use the field as a
    # free-text channel that can include customer-supplied strings.
    write_audit(
        db,
        action_type="TRANSACTION_UPDATE",
        target_table="transactions",
        record_id=updated.id,
        user_id=current_user.id,
        old_data=before,
        new_data={"has_notes": updated.notes is not None},
        request=request,
    )
    db.commit()
    return updated


# --------------------------------------------------
# SOFT DELETE (Admin only)
# --------------------------------------------------
@router.delete(
    "/{transaction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft delete a transaction (FAILED only)",
)
def delete_transaction_route(
    request: Request,
    transaction_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    transaction = get_transaction(db, transaction_id)
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found"
        )

    snapshot = _txn_audit_snapshot(transaction)
    try:
        soft_delete_transaction(
            db=db, transaction=transaction, deleted_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    write_audit(
        db,
        action_type="TRANSACTION_DELETE",
        target_table="transactions",
        record_id=transaction.id,
        user_id=current_user.id,
        old_data=snapshot,
        request=request,
    )
    db.commit()
