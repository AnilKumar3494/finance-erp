import uuid
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.access import assert_loan_access
from app.dependencies.auth import get_current_user, require_admin
from app.models.due_cycle import CycleStatus, DueCycle
from app.models.loan import Loan
from app.models.transaction import PunctualityStatus, Transaction
from app.models.user import User
from app.schemas.due_cycle import (
    CycleClassifyRequest,
    CycleClassifyResponse,
    DueCycleListResponse,
    DueCycleResponse,
    PenaltyEventResponse,
)
from app.services.due_cycle import get_cycle, list_cycles_for_loan
from app.services.penalty import (
    apply_penalty,
    compute_shortfall,
    get_active_penalty_for_cycle,
    mark_cycle_paid_on_time,
    reclassify_cycle,
    write_reclassify_audit,
)
from app.utils.audit import write_audit

router = APIRouter(prefix="/due-cycles", tags=["Due Cycles"])


# --------------------------------------------------
# HELPERS
# --------------------------------------------------
def _to_response(cycle: DueCycle) -> DueCycleResponse:
    """Build the response, attaching the computed shortfall."""
    resp = DueCycleResponse.model_validate(cycle)
    resp.shortfall = compute_shortfall(cycle)
    return resp


# Centralized in app/dependencies/access.py — rebound here so existing
# call sites in this file keep their local name.
_assert_loan_access = assert_loan_access


def _propagate_punctuality_to_transactions(
    db: Session, cycle: DueCycle, new_status: PunctualityStatus
) -> None:
    """
    When a cycle is classified, set the same punctuality on every active
    transaction allocated to it so individual receipts carry the cycle's
    verdict consistently.
    """
    db.query(Transaction).filter(
        Transaction.due_cycle_id == cycle.id,
        Transaction.is_deleted.is_(False),
    ).update(
        {Transaction.punctuality_status: new_status},
        synchronize_session=False,
    )


# --------------------------------------------------
# GET ONE CYCLE
# --------------------------------------------------
@router.get(
    "/{cycle_id}",
    response_model=DueCycleResponse,
    summary="Get a single due cycle",
)
def get_one(
    cycle_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cycle = get_cycle(db, cycle_id)
    if not cycle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cycle not found"
        )
    loan = db.query(Loan).filter(Loan.id == cycle.loan_id).first()
    if loan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cycle's loan not found"
        )
    _assert_loan_access(loan, current_user, db)
    return _to_response(cycle)


# --------------------------------------------------
# LIST CYCLES FOR A LOAN
# --------------------------------------------------
@router.get(
    "/loan/{loan_id}",
    response_model=DueCycleListResponse,
    summary="List all due cycles for a loan",
)
def list_for_loan(
    loan_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted.is_(False)).first()
    if loan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )
    _assert_loan_access(loan, current_user, db)

    cycles = list_cycles_for_loan(db, loan_id)
    return DueCycleListResponse(
        loan_id=loan_id,
        total=len(cycles),
        page=1,
        page_size=len(cycles),
        results=[_to_response(c) for c in cycles],
    )


# --------------------------------------------------
# CLASSIFY A CYCLE
# Admin / Super-Admin only.
#   PAID_ON_TIME   → only if shortfall == 0
#   LATE_PAYMENT   → requires classified_as_of_date > cycle.due_date
# Re-classification of an already-classified cycle goes through the
# dedicated /reclassify endpoint (step 6) for the supersession audit.
# --------------------------------------------------
@router.post(
    "/{cycle_id}/classify",
    response_model=CycleClassifyResponse,
    summary="Classify a due cycle (PAID_ON_TIME or LATE_PAYMENT)",
)
def classify_cycle(
    request: Request,
    cycle_id: uuid.UUID,
    payload: CycleClassifyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cycle = get_cycle(db, cycle_id)
    if not cycle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cycle not found"
        )

    # Block initial-classification on already-finalised cycles.
    if cycle.cycle_status in (
        CycleStatus.PAID_ON_TIME,
        CycleStatus.LATE_PAYMENT,
        CycleStatus.MISSED_CAPPED,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Cycle is already {cycle.cycle_status.value}. Use the "
                "reclassify endpoint to change it."
            ),
        )

    # Lock the loan row to prevent concurrent penalty / payment races.
    loan = (
        db.query(Loan)
        .filter(Loan.id == cycle.loan_id, Loan.is_deleted.is_(False))
        .with_for_update()
        .first()
    )
    if loan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )

    old_status = cycle.cycle_status.value
    penalty_event = None
    try:
        if payload.cycle_status == CycleStatus.PAID_ON_TIME:
            mark_cycle_paid_on_time(
                db,
                cycle,
                classified_by=current_user.id,
                classification_note=payload.classification_note,
            )
            _propagate_punctuality_to_transactions(
                db, cycle, PunctualityStatus.PAID_ON_TIME
            )
        else:  # LATE_PAYMENT
            assert payload.classified_as_of_date is not None  # validated by schema
            penalty_event = apply_penalty(
                db,
                cycle=cycle,
                loan=loan,
                classified_as_of_date=payload.classified_as_of_date,
                classified_by=current_user.id,
                classification_note=payload.classification_note,
            )
            _propagate_punctuality_to_transactions(
                db, cycle, PunctualityStatus.LATE_PAYMENT
            )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # D1: reclassify already records a supersession audit row. First-time
    # classify (this branch) didn't — fixed here. Penalty math itself lives
    # in penalty_events; this row captures the human-decision context.
    write_audit(
        db,
        action_type="DUE_CYCLE_CLASSIFY",
        target_table="due_cycles",
        record_id=cycle.id,
        user_id=current_user.id,
        old_data={"cycle_status": old_status},
        new_data={
            "loan_id": str(loan.id),
            "cycle_number": cycle.cycle_number,
            "cycle_status": cycle.cycle_status.value,
            "classified_as_of_date": (
                payload.classified_as_of_date.isoformat()
                if payload.classified_as_of_date
                else None
            ),
            "penalty_event_id": (
                str(penalty_event.id) if penalty_event is not None else None
            ),
            "note_provided": bool(payload.classification_note),
        },
        request=request,
    )
    db.commit()
    db.refresh(cycle)

    return CycleClassifyResponse(
        cycle=_to_response(cycle),
        penalty_event=(
            PenaltyEventResponse.model_validate(penalty_event)
            if penalty_event is not None
            else None
        ),
    )


# --------------------------------------------------
# RECLASSIFY A CYCLE
# Admin / Super-Admin can change the verdict on an already-classified
# cycle. Old penalty_event is superseded (audit chain), addons are
# recomputed, transactions re-propagated, and an audit_logs row is
# appended.
# --------------------------------------------------
@router.post(
    "/{cycle_id}/reclassify",
    response_model=CycleClassifyResponse,
    summary="Reclassify an already-classified cycle (writes audit row)",
)
def reclassify_cycle_route(
    cycle_id: uuid.UUID,
    payload: CycleClassifyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cycle = get_cycle(db, cycle_id)
    if not cycle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cycle not found"
        )

    if cycle.cycle_status not in (
        CycleStatus.PAID_ON_TIME,
        CycleStatus.LATE_PAYMENT,
        CycleStatus.MISSED_CAPPED,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Cycle is {cycle.cycle_status.value} — use /classify "
                "for first-time classification, not /reclassify"
            ),
        )

    # Snapshot the OLD state for the audit row (before any mutations).
    old_status = cycle.cycle_status.value
    old_penalty = cycle.penalty_amount

    # Lock the loan to serialise concurrent reclassifications / payments.
    loan = (
        db.query(Loan)
        .filter(Loan.id == cycle.loan_id, Loan.is_deleted.is_(False))
        .with_for_update()
        .first()
    )
    if loan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )

    try:
        cycle, new_event = reclassify_cycle(
            db,
            cycle=cycle,
            loan=loan,
            new_status=payload.cycle_status,
            classified_as_of_date=payload.classified_as_of_date,
            classified_by=current_user.id,
            classification_note=payload.classification_note,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Re-propagate transaction punctuality to match the new cycle status.
    new_punctuality = (
        PunctualityStatus.PAID_ON_TIME
        if payload.cycle_status == CycleStatus.PAID_ON_TIME
        else PunctualityStatus.LATE_PAYMENT
    )
    _propagate_punctuality_to_transactions(db, cycle, new_punctuality)

    # Audit row.
    write_reclassify_audit(
        db,
        cycle=cycle,
        actor_id=current_user.id,
        old_status=old_status,
        old_penalty=old_penalty,
        new_status=cycle.cycle_status.value,
        new_penalty=cycle.penalty_amount,
        classified_as_of_date=payload.classified_as_of_date,
        note=payload.classification_note,
    )

    db.commit()
    db.refresh(cycle)

    return CycleClassifyResponse(
        cycle=_to_response(cycle),
        penalty_event=(
            PenaltyEventResponse.model_validate(new_event)
            if new_event is not None
            else None
        ),
    )
