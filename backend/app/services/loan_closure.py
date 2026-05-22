"""
Loan closure service.

Handles the admin-triggered transition out of ACTIVE / AWAITING_CLOSURE /
BAD_DEBT_PROPOSED into a terminal state (CLOSED or BAD_DEBT), writing a
`loan_closures` row with full audit fields.
"""
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.models.loan import Loan, LoanStatus
from app.models.loan_closure import ClosureType, LoanClosure
from app.schemas.loan_closure import LoanCloseRequest
from app.services.transaction import get_loan_transaction_summary


# Loan statuses from which closure is allowed.
_CLOSEABLE_STATUSES = {
    LoanStatus.ACTIVE,
    LoanStatus.AWAITING_CLOSURE,
    LoanStatus.BAD_DEBT_PROPOSED,
}


def close_loan(
    db: Session,
    loan: Loan,
    data: LoanCloseRequest,
    closed_by: uuid.UUID,
) -> LoanClosure:
    """
    Finalise a loan. Caller must hold a `with_for_update` lock on the loan.

    Rules:
      - Loan must be in one of: ACTIVE, AWAITING_CLOSURE, BAD_DEBT_PROPOSED.
      - NORMAL_TENURE / EARLY_FORECLOSURE require outstanding == 0.
      - NEGOTIATED_SETTLEMENT may have outstanding > 0; amount_written_off
        must equal outstanding - final_settlement_amount.
      - WRITE_OFF: amount_written_off must equal current outstanding; goes
        to BAD_DEBT terminal state.
      - At most one active (non-superseded, non-deleted) closure per loan
        (DB enforces via partial unique index uq_loan_closures_loan_active).
    """
    if loan.status not in _CLOSEABLE_STATUSES:
        raise ValueError(
            f"Loan cannot be closed from status {loan.status.value}"
        )

    # Explicit pre-check: surface a clean domain error rather than letting
    # the partial unique index `uq_loan_closures_loan_active` blow up as
    # a 500 from IntegrityError.
    existing = get_active_closure_for_loan(db, loan.id)
    if existing is not None:
        raise ValueError(
            f"An active closure already exists for this loan "
            f"(closure id={existing.id})"
        )

    summary = get_loan_transaction_summary(db, loan)
    outstanding: Decimal = summary["outstanding"]

    # Validate per closure_type.
    if data.closure_type in (ClosureType.NORMAL_TENURE, ClosureType.EARLY_FORECLOSURE):
        if outstanding > Decimal("0.00"):
            raise ValueError(
                f"Cannot close as {data.closure_type.value} — outstanding balance "
                f"is {outstanding}. Use NEGOTIATED_SETTLEMENT or WRITE_OFF, "
                "or collect the balance first."
            )
        if data.amount_written_off and data.amount_written_off > 0:
            raise ValueError(
                "amount_written_off must be 0 for "
                f"{data.closure_type.value} closures"
            )
        new_status = LoanStatus.CLOSED

    elif data.closure_type == ClosureType.NEGOTIATED_SETTLEMENT:
        expected_writeoff = (outstanding - data.final_settlement_amount).quantize(Decimal("0.01"))
        if expected_writeoff < 0:
            raise ValueError(
                "final_settlement_amount exceeds outstanding balance "
                f"({data.final_settlement_amount} > {outstanding})"
            )
        if data.amount_written_off != expected_writeoff:
            raise ValueError(
                f"amount_written_off ({data.amount_written_off}) must equal "
                f"outstanding ({outstanding}) - final_settlement_amount "
                f"({data.final_settlement_amount}) = {expected_writeoff}"
            )
        new_status = LoanStatus.CLOSED

    elif data.closure_type == ClosureType.WRITE_OFF:
        if data.amount_written_off != outstanding:
            raise ValueError(
                f"amount_written_off ({data.amount_written_off}) must equal "
                f"outstanding ({outstanding}) for WRITE_OFF closures"
            )
        if data.final_settlement_amount > 0:
            raise ValueError(
                "final_settlement_amount must be 0 for WRITE_OFF closures"
            )
        new_status = LoanStatus.BAD_DEBT
    else:
        raise ValueError(f"Unknown closure_type: {data.closure_type}")

    closure = LoanClosure(
        loan_id=loan.id,
        closure_type=data.closure_type,
        closing_charges=(
            Decimal("0.00") if data.charge_waived else data.closing_charges
        ),
        charge_waived=data.charge_waived,
        waiver_reason=data.waiver_reason,
        final_settlement_amount=data.final_settlement_amount,
        outstanding_at_closure=outstanding,
        amount_written_off=data.amount_written_off,
        refund_due_to_customer=data.refund_due_to_customer,
        refund_status=data.refund_status,
        closure_date=data.closure_date or date.today(),
        noc_issued=data.noc_issued,
        noc_reference=data.noc_reference,
        closure_remarks=data.closure_remarks,
        supporting_document_id=data.supporting_document_id,
        closed_by_id=closed_by,
        created_by_id=closed_by,
    )
    db.add(closure)

    loan.status = new_status
    loan.updated_by_id = closed_by

    db.flush()  # FK-safe; route owns the commit
    return closure


def get_active_closure_for_loan(
    db: Session, loan_id: uuid.UUID
) -> Optional[LoanClosure]:
    """The currently-active (non-superseded, non-deleted) closure row, if any."""
    return (
        db.query(LoanClosure)
        .filter(
            LoanClosure.loan_id == loan_id,
            LoanClosure.is_deleted.is_(False),
            LoanClosure.superseded_by_id.is_(None),
        )
        .first()
    )
