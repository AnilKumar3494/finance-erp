import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin
from app.models.bad_debt_proposal import BadDebtProposal, BadDebtProposalStatus
from app.models.loan import Loan
from app.models.user import User
from app.schemas.bad_debt_proposal import (
    BadDebtProposalListResponse,
    BadDebtProposalResponse,
    BadDebtProposeRequest,
    BadDebtReviewRequest,
)
from app.services.bad_debt import (
    get_open_proposal,
    propose_bad_debt,
    review_proposal,
)

# Two routers — one under /loans/{id}/bad-debt for create, one under
# /bad-debt-proposals for list/get/review.
propose_router = APIRouter(prefix="/loans", tags=["Bad Debt"])
review_router = APIRouter(prefix="/bad-debt-proposals", tags=["Bad Debt"])


@propose_router.post(
    "/{loan_id}/bad-debt/propose",
    response_model=BadDebtProposalResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Propose a loan for bad-debt review",
)
def propose_route(
    loan_id: uuid.UUID,
    payload: BadDebtProposeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Any authenticated role can propose. Approval is admin-gated.
    loan = (
        db.query(Loan)
        .filter(Loan.id == loan_id, Loan.is_deleted.is_(False))
        .with_for_update()
        .first()
    )
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )

    try:
        proposal = propose_bad_debt(
            db, loan=loan, proposed_by=current_user.id, reason=payload.proposed_reason
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    db.commit()
    db.refresh(proposal)
    return proposal


@review_router.get(
    "/",
    response_model=BadDebtProposalListResponse,
    summary="List bad-debt proposals (admin)",
)
def list_proposals(
    status_filter: Optional[BadDebtProposalStatus] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    q = db.query(BadDebtProposal).filter(BadDebtProposal.is_deleted.is_(False))
    if status_filter:
        q = q.filter(BadDebtProposal.status == status_filter)
    total = q.count()
    results = (
        q.order_by(BadDebtProposal.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return BadDebtProposalListResponse(
        total=total, page=page, page_size=page_size, results=results
    )


@review_router.get(
    "/{proposal_id}",
    response_model=BadDebtProposalResponse,
    summary="Get a bad-debt proposal (admin)",
)
def get_one(
    proposal_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    proposal = (
        db.query(BadDebtProposal)
        .filter(
            BadDebtProposal.id == proposal_id,
            BadDebtProposal.is_deleted.is_(False),
        )
        .first()
    )
    if not proposal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found"
        )
    return proposal


@review_router.post(
    "/{proposal_id}/review",
    response_model=BadDebtProposalResponse,
    summary="Approve or reject a bad-debt proposal (admin/super-admin)",
)
def review_route(
    proposal_id: uuid.UUID,
    payload: BadDebtReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    proposal = (
        db.query(BadDebtProposal)
        .filter(
            BadDebtProposal.id == proposal_id,
            BadDebtProposal.is_deleted.is_(False),
        )
        .first()
    )
    if not proposal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found"
        )

    loan = (
        db.query(Loan)
        .filter(Loan.id == proposal.loan_id, Loan.is_deleted.is_(False))
        .with_for_update()
        .first()
    )
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )

    try:
        review_proposal(
            db,
            proposal=proposal,
            loan=loan,
            decision=payload.decision,
            reviewer_id=current_user.id,
            review_notes=payload.review_notes,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    db.commit()
    db.refresh(proposal)
    return proposal
