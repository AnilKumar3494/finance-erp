import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import Request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.models.customer import Customer
from app.models.due_cycle import CycleStatus, DueCycle
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
from app.utils.audit import write_audit


def _txn_audit_snapshot(t: Transaction) -> dict:
    """Money record — `amount` is part of the audit on purpose. `notes`
    is free text and may contain customer-supplied strings; excluded."""
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


def list_pending_confirmations(
    db: Session,
    *,
    assigned_employee_id: Optional[uuid.UUID] = None,
    paid_after: Optional[date] = None,
    paid_before: Optional[date] = None,
    page: int = 1,
    page_size: int = 20,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = None,
) -> tuple[list[tuple], int, Decimal]:
    """
    Cross-loan worklist of PENDING transactions awaiting admin confirm/fail.

    Joins each pending transaction to its loan + customer (and left-joins the
    allocated due-cycle) so the Collections & Actions surface can render the
    row without N+1 lookups. EMPLOYEE scope limits to their assigned customers.

    `paid_after` / `paid_before` window on effective_payment_date — the date the
    money actually changed hands, which is what a collector filtering "what came
    in last week" means. Both bounds are inclusive and optional.

    Returns (rows, total, total_pending_amount) where each row is a
    (Transaction, Loan, Customer, DueCycle|None) tuple. Oldest-waiting first so
    the longest-outstanding confirmations float to the top.
    """
    query = (
        db.query(Transaction, Loan, Customer, DueCycle)
        .join(Loan, Transaction.loan_id == Loan.id)
        .join(Customer, Loan.customer_id == Customer.id)
        .outerjoin(DueCycle, Transaction.due_cycle_id == DueCycle.id)
        .filter(
            Transaction.status == TransactionStatus.PENDING,
            Transaction.is_deleted.is_(False),
            Loan.is_deleted.is_(False),
            Customer.is_deleted.is_(False),
        )
    )

    if assigned_employee_id is not None:
        query = query.filter(Customer.assigned_employee_id == assigned_employee_id)

    if paid_after is not None:
        query = query.filter(Transaction.effective_payment_date >= paid_after)

    if paid_before is not None:
        query = query.filter(Transaction.effective_payment_date <= paid_before)

    total = query.count()
    total_amount = (
        query.with_entities(func.coalesce(func.sum(Transaction.amount), 0)).scalar()
    )

    # Sortable columns. Default is created_at asc (oldest-waiting first). A
    # stable secondary key (txn id) keeps pagination consistent on ties.
    sortable = {
        "amount": Transaction.amount,
        "effective_payment_date": Transaction.effective_payment_date,
        "created_at": Transaction.created_at,
        "customer_name": Customer.full_name,
        "loan": Loan.hp_number,
    }
    column = sortable.get(sort_by or "created_at", Transaction.created_at)
    descending = (sort_order or "asc").lower() == "desc"
    ordering = column.desc() if descending else column.asc()

    rows = (
        query.order_by(ordering, Transaction.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return rows, total, Decimal(str(total_amount))


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

    # A DRAFT loan has no schedule yet: principal, interest_rate and tenure
    # are all NULL until it is approved. calc_total_payable raises TypeError
    # on Decimal(None), which surfaced as a 500 on every draft's detail and
    # edit page. No schedule means nothing is payable yet.
    has_schedule = (
        loan.principal is not None
        and loan.interest_rate is not None
        and loan.tenure is not None
    )
    base_total_payable = (
        calc_total_payable(loan.principal, loan.interest_rate, loan.tenure)
        if has_schedule
        else Decimal("0.00")
    )
    active_penalty = sum_active_penalties_for_loan(db, loan.id)
    total_payable = (base_total_payable + active_penalty).quantize(Decimal("0.01"))
    outstanding = max(total_payable - total_paid, Decimal("0.00"))

    return {
        "loan_id": loan.id,
        # LoanTransactionSummary.principal is a required Decimal — a draft's
        # NULL would fail response validation and 500 just as loudly.
        "principal": loan.principal if loan.principal is not None else Decimal("0.00"),
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


def maybe_auto_classify_cycle(
    db: Session,
    cycle: DueCycle,
    classifier_id: uuid.UUID,
) -> bool:
    """
    Auto-promote a cycle to PAID_ON_TIME when the obvious-clean conditions
    are met — i.e. there's no judgment call left for an admin to make:

      - cycle is currently AWAITING_REVIEW (the "needs classify" state),
      - the cycle's shortfall is zero (total_received >= total_due),
      - every SUCCESS transaction allocated to this cycle landed on or
        before the due_date (no late payments).

    When any payment came in late, leaving the cycle in AWAITING_REVIEW
    is the right move — an admin still has to decide LATE_PAYMENT vs
    PAID_ON_TIME (with grace) and the penalty math hangs off that call.
    The system doesn't make penalty decisions on its own.

    The caller is expected to have already called recompute_cycle_totals
    on the SAME open transaction so cycle.total_received is fresh.

    Returns True when classification fired, False otherwise.
    """
    if cycle.cycle_status != CycleStatus.AWAITING_REVIEW:
        return False
    if cycle.total_received < cycle.total_due:
        return False

    has_late_txn = (
        db.query(Transaction.id)
        .filter(
            Transaction.due_cycle_id == cycle.id,
            Transaction.status == TransactionStatus.SUCCESS,
            Transaction.is_deleted.is_(False),
            Transaction.effective_payment_date > cycle.due_date,
        )
        .first()
        is not None
    )
    if has_late_txn:
        return False

    cycle.cycle_status = CycleStatus.PAID_ON_TIME
    cycle.classified_as_of_date = cycle.due_date
    cycle.classified_by_id = classifier_id
    cycle.classified_at = datetime.now(timezone.utc)
    cycle.classification_note = "Auto-classified — paid in full by due date"

    # Mirror the manual classify path: every SUCCESS transaction on this
    # cycle inherits the cycle's punctuality so individual receipts carry
    # the same verdict.
    db.query(Transaction).filter(
        Transaction.due_cycle_id == cycle.id,
        Transaction.is_deleted.is_(False),
    ).update(
        {Transaction.punctuality_status: PunctualityStatus.PAID_ON_TIME},
        synchronize_session=False,
    )
    return True


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
    db: Session,
    data: TransactionCreate,
    created_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> Transaction:
    """
    Record a payment against a loan.
    - Validates loan exists and is ACTIVE
    - Locks loan row to prevent concurrent overpayment
    - Counts PENDING toward reserved amount
    - Supports idempotency_key to prevent duplicates
    - Allocates to a due-cycle based on effective_payment_date (or admin override)
    """
    # --- Idempotency check (loan-scoped per migration 005) ---
    if data.idempotency_key:
        existing = (
            db.query(Transaction)
            .filter(
                Transaction.loan_id == data.loan_id,
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

    # --- Overpayment handling ---
    # Per the agreed spec (Case 16): accept overpayments instead of rejecting
    # them. Annotate the transaction's notes so the admin can see and decide
    # how to handle the excess (refund / fee / leave as credit).
    summary = get_loan_transaction_summary(db, loan)
    effective_outstanding = summary["outstanding"] - summary["total_pending"]

    overpayment_excess = Decimal("0.00")
    if data.amount > effective_outstanding and effective_outstanding > 0:
        overpayment_excess = (data.amount - effective_outstanding).quantize(Decimal("0.01"))
    elif effective_outstanding <= 0:
        # No room for ANY further payment (already paid in full or pending-reserved fully)
        overpayment_excess = data.amount

    # --- Resolve effective date and target due-cycle ---
    eff_date = data.effective_payment_date or date.today()
    target_cycle = resolve_due_cycle_for_payment(
        db=db,
        loan=loan,
        effective_payment_date=eff_date,
        override_cycle_id=data.due_cycle_id,
    )

    # Auto-tag the notes when this payment exceeds outstanding so the admin
    # sees the flag the next time they open the transaction.
    base_notes = data.notes or ""
    if overpayment_excess > 0:
        flag_line = (
            f"[ADMIN NOTE] Overpayment by {overpayment_excess} "
            f"(outstanding was {summary['outstanding']}, pending "
            f"{summary['total_pending']}). Admin should review (refund / fee / leave as credit)."
        )
        base_notes = (base_notes + ("\n" if base_notes else "") + flag_line).strip()

    transaction = Transaction(
        loan_id=data.loan_id,
        amount=data.amount,
        ta_amount=data.ta_amount or Decimal("0"),
        payment_mode=data.payment_mode,
        notes=base_notes or None,
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
        db.flush()
        write_audit(
            db,
            action_type="TRANSACTION_CREATE",
            target_table="transactions",
            record_id=transaction.id,
            user_id=created_by,
            new_data=_txn_audit_snapshot(transaction),
            request=request,
        )
        db.commit()
        db.refresh(transaction)
        # PENDING transactions don't change cycle.total_received yet — that
        # happens at admin confirmation in step 5.
        return transaction
    except IntegrityError as e:
        db.rollback()
        # Idempotency key collision from concurrent request (loan-scoped now)
        if "idempotency_key" in str(e.orig):
            existing = (
                db.query(Transaction)
                .filter(
                    Transaction.loan_id == data.loan_id,
                    Transaction.idempotency_key == data.idempotency_key,
                )
                .first()
            )
            if existing:
                return existing
        raise ValueError("Failed to record transaction")


# --------------------------------------------------
# CONFIRM
# --------------------------------------------------
def confirm_transaction(
    db: Session,
    transaction: Transaction,
    updated_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> Transaction:
    """
    Mark a PENDING transaction as SUCCESS.
    Re-validates outstanding with a loan lock to prevent overpayment on confirm.
    """
    if transaction.status != TransactionStatus.PENDING:
        raise ValueError(f"Transaction is already {transaction.status.value}")

    before = _txn_audit_snapshot(transaction)

    # --- Lock loan and re-validate outstanding ---
    loan = (
        db.query(Loan).filter(Loan.id == transaction.loan_id).with_for_update().first()
    )

    if loan.status != LoanStatus.ACTIVE:
        raise ValueError(f"Cannot confirm — loan is {loan.status.value}")

    summary = get_loan_transaction_summary(db, loan)

    # Confirmation may push the loan into overpayment territory; per the
    # accept-overpayment policy (Case 16) we let it through. The note set at
    # create time already flags the excess for the admin.
    new_total_paid = summary["total_paid"] + transaction.amount
    if new_total_paid > summary["total_payable"]:
        logger.warning(
            "confirm_transaction allowing overpayment: loan=%s "
            "total_payable=%s new_total_paid=%s",
            loan.id, summary["total_payable"], new_total_paid,
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
            # If this confirm completes the cycle cleanly (no late txns,
            # shortfall=0), promote it to PAID_ON_TIME so the admin doesn't
            # have to manually classify the trivial case.
            maybe_auto_classify_cycle(db, cycle, updated_by)

    # --- Move to AWAITING_CLOSURE when fully paid ---
    # No more auto-close: the admin must finalise via /loans/{id}/close,
    # which records closure_type, charges, NOC, etc.
    refreshed_summary = get_loan_transaction_summary(db, loan)
    if refreshed_summary["outstanding"] <= Decimal("0.00") and loan.status == LoanStatus.ACTIVE:
        loan.status = LoanStatus.AWAITING_CLOSURE
        loan.updated_by_id = updated_by

    write_audit(
        db,
        action_type="TRANSACTION_CONFIRM",
        target_table="transactions",
        record_id=transaction.id,
        user_id=updated_by,
        old_data=before,
        new_data=_txn_audit_snapshot(transaction),
        request=request,
    )
    db.commit()
    db.refresh(transaction)

    return transaction


# --------------------------------------------------
# FAIL
# --------------------------------------------------
def fail_transaction(
    db: Session,
    transaction: Transaction,
    updated_by: uuid.UUID,
    reason: Optional[str] = None,
    *,
    request: Optional[Request] = None,
) -> Transaction:
    """Mark a PENDING transaction as FAILED (e.g. bounced cheque, failed UPI)"""
    if transaction.status != TransactionStatus.PENDING:
        raise ValueError(f"Transaction is already {transaction.status.value}")

    before = _txn_audit_snapshot(transaction)
    transaction.status = TransactionStatus.FAILED
    transaction.updated_by_id = updated_by
    if reason:
        transaction.notes = f"{transaction.notes or ''} | FAILED: {reason}".strip(" |")
    db.flush()
    write_audit(
        db,
        action_type="TRANSACTION_FAIL",
        target_table="transactions",
        record_id=transaction.id,
        user_id=updated_by,
        old_data=before,
        new_data={
            **_txn_audit_snapshot(transaction),
            "fail_reason_provided": reason is not None,
        },
        request=request,
    )
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
    *,
    request: Optional[Request] = None,
) -> Transaction:
    """
    Edit an existing transaction. Status changes still go through /confirm or
    /fail — this endpoint corrects mistakes (wrong cycle, wrong amount, wrong
    mode, wrong date, typo in notes).

    SUCCESS edits are allowed: this is the supported path to rescue a NULL-
    cycle SUCCESS transaction that bypassed the cycle ledger, or to fix a
    cycle allocation that landed on the wrong row. Whenever the cycle
    allocation or amount changes on a SUCCESS row, both the previous and
    the new cycle's total_received is recomputed so the ledger stays in
    sync — the read total at any point reflects the SUM of all SUCCESS
    transactions allocated to that cycle.

    Route-level access control (see routes/transactions.py): SUCCESS rows
    require admin; PENDING / FAILED rows are editable by any user in scope
    of the loan.
    """
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        return transaction

    if "due_cycle_id" in fields:
        new_cycle_id = fields["due_cycle_id"]
        # Reuse the create-time resolver so the new cycle is validated against
        # the same loan and the deletion check fires. None here means "leave
        # unallocated" — we still permit it via edit because the existing data
        # has legacy nulls, but new creates can't introduce them (schema).
        if new_cycle_id is None:
            new_cycle = None
        else:
            new_cycle = (
                db.query(DueCycle)
                .filter(
                    DueCycle.id == new_cycle_id,
                    DueCycle.loan_id == transaction.loan_id,
                    DueCycle.is_deleted.is_(False),
                )
                .first()
            )
            if new_cycle is None:
                raise ValueError("due_cycle_id does not belong to this loan or is deleted")
        fields["due_cycle_id"] = new_cycle.id if new_cycle else None

    before = _txn_audit_snapshot(transaction)
    old_cycle_id = transaction.due_cycle_id
    old_amount = transaction.amount

    for field, value in fields.items():
        setattr(transaction, field, value)
    transaction.updated_by_id = updated_by
    db.flush()

    # Cycle ledger maintenance: only SUCCESS transactions contribute to
    # cycle.total_received. PENDING/FAILED edits don't touch the ledger.
    if transaction.status == TransactionStatus.SUCCESS:
        affected_cycle_ids = set()
        if old_cycle_id is not None:
            affected_cycle_ids.add(old_cycle_id)
        if transaction.due_cycle_id is not None:
            affected_cycle_ids.add(transaction.due_cycle_id)
        # If neither cycle nor amount changed there's nothing to recompute,
        # but the dict is tiny and recompute is a single aggregate — cheap.
        for cid in affected_cycle_ids:
            cycle = (
                db.query(DueCycle)
                .filter(DueCycle.id == cid)
                .with_for_update()
                .first()
            )
            if cycle is not None:
                recompute_cycle_totals(db, cycle)
                # An edit that rescues a NULL-cycle SUCCESS into a real
                # cycle (or fixes an amount that finally clears shortfall)
                # follows the same auto-classify rule as confirm: clean
                # on-time completions resolve themselves.
                maybe_auto_classify_cycle(db, cycle, updated_by)
        # Avoid unused-variable lint
        _ = old_amount

    write_audit(
        db,
        action_type="TRANSACTION_UPDATE",
        target_table="transactions",
        record_id=transaction.id,
        user_id=updated_by,
        old_data=before,
        new_data=_txn_audit_snapshot(transaction),
        request=request,
    )
    db.commit()
    db.refresh(transaction)
    return transaction


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
def soft_delete_transaction(
    db: Session,
    transaction: Transaction,
    deleted_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
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

    snapshot = _txn_audit_snapshot(transaction)
    # Use AuditBase.soft_delete so deleted_by_id is also set (review item T5).
    transaction.soft_delete(deleted_by)
    db.flush()
    write_audit(
        db,
        action_type="TRANSACTION_DELETE",
        target_table="transactions",
        record_id=transaction.id,
        user_id=deleted_by,
        old_data=snapshot,
        request=request,
    )
    db.commit()
    return transaction
