import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.access import assert_loan_access
from app.dependencies.auth import get_current_user, require_admin
from app.models.loan import Loan
from app.models.transaction import Transaction, TransactionStatus
from app.models.user import User, UserRole
from app.schemas.transaction import (
    LoanTransactionSummary,
    PendingConfirmationItem,
    PendingConfirmationListResponse,
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
    list_pending_confirmations,
    list_transactions,
    soft_delete_transaction,
    update_transaction,
)

router = APIRouter(prefix="/transactions", tags=["Transactions"])

# Audit lives in the service layer — see app/services/transaction.py.


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
    _assert_loan_in_user_scope(db, transaction.loan_id, current_user)


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
    _assert_loan_in_user_scope(db, payload.loan_id, current_user)
    # The frontend sends the dedupe key as an `Idempotency-Key` HTTP header
    # (client.ts interceptor), while the service dedupes on
    # payload.idempotency_key. Bridge the two so a retried POST carrying the
    # same key returns the existing row instead of creating a duplicate. An
    # explicit body value wins if a caller set both.
    if not payload.idempotency_key:
        header_key = request.headers.get("Idempotency-Key")
        if header_key:
            payload.idempotency_key = header_key[:64]
    try:
        return create_transaction(
            db=db, data=payload, created_by=current_user.id, request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


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
# PENDING CONFIRMATIONS WORKLIST (Collections & Actions)
# Registered before /{transaction_id} so the static path isn't shadowed.
# --------------------------------------------------
@router.get(
    "/pending-confirmations",
    response_model=PendingConfirmationListResponse,
    summary="Cross-loan list of payments awaiting confirmation",
)
def pending_confirmations(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: Optional[str] = Query(
        None,
        description="Sort column: amount | effective_payment_date | created_at | customer_name | loan",
    ),
    sort_order: Optional[str] = Query(None, description="asc | desc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    scope = current_user.id if current_user.role == UserRole.EMPLOYEE else None
    rows, total, total_amount = list_pending_confirmations(
        db,
        assigned_employee_id=scope,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    results = [
        PendingConfirmationItem(
            id=txn.id,
            loan_id=loan.id,
            loan_number=loan.loan_number,
            hp_number=loan.hp_number,
            customer_id=customer.id,
            customer_name=customer.full_name,
            customer_mobile=customer.mobile_number,
            amount=txn.amount,
            payment_mode=txn.payment_mode,
            effective_payment_date=txn.effective_payment_date,
            collected_by_id=txn.collected_by_id,
            created_at=txn.created_at,
            due_cycle_id=txn.due_cycle_id,
            cycle_number=cycle.cycle_number if cycle is not None else None,
            cycle_due_date=cycle.due_date if cycle is not None else None,
        )
        for txn, loan, customer, cycle in rows
    ]
    return PendingConfirmationListResponse(
        total=total,
        page=page,
        page_size=page_size,
        total_pending_amount=total_amount,
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
    try:
        return confirm_transaction(
            db=db,
            transaction=transaction,
            updated_by=current_user.id,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


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
    try:
        return fail_transaction(
            db=db,
            transaction=transaction,
            updated_by=current_user.id,
            reason=reason,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# --------------------------------------------------
# UPDATE (edit-after-record)
# --------------------------------------------------
# Editing a transaction supports two cases:
#   1. PENDING/FAILED — anyone in scope of the loan (admin or assigned
#      employee) can correct a misclick before the txn is confirmed. This
#      mirrors the "the collector who recorded it can fix their own typo"
#      expectation; the loan-scope check below still applies.
#   2. SUCCESS — admin only. Editing a confirmed transaction recomputes
#      the cycle ledger (old + new cycle's total_received), so it's a
#      sensitive operation we lock behind ADMIN/SUPER_ADMIN.
@router.patch(
    "/{transaction_id}",
    response_model=TransactionResponse,
    summary="Edit a transaction (cycle, amount, mode, date, notes)",
)
def update_transaction_route(
    request: Request,
    transaction_id: uuid.UUID,
    payload: TransactionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    transaction = get_transaction(db, transaction_id)
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found"
        )
    _assert_transaction_in_user_scope(db, transaction, current_user)
    if transaction.status == TransactionStatus.SUCCESS and current_user.role not in (
        UserRole.ADMIN,
        UserRole.SUPER_ADMIN,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an admin can edit a confirmed transaction.",
        )
    try:
        return update_transaction(
            db=db,
            transaction=transaction,
            data=payload,
            updated_by=current_user.id,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


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
    try:
        soft_delete_transaction(
            db=db,
            transaction=transaction,
            deleted_by=current_user.id,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
