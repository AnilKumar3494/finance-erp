import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin
from app.models.bad_debt_proposal import BadDebtProposal, BadDebtProposalStatus
from app.models.customer import Customer
from app.models.loan import Loan
from app.models.user import User
from app.schemas.bad_debt_proposal import (
    BadDebtProposalListItem,
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
from app.utils.audit import write_audit

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
    request: Request,
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

    # B1: bad-debt lifecycle moves real money toward write-off. Capture the
    # proposer, the loan state at proposal time, and the reason length
    # (never the reason text — it may contain customer-supplied PII).
    write_audit(
        db,
        action_type="BAD_DEBT_PROPOSE",
        target_table="bad_debt_proposals",
        record_id=proposal.id,
        user_id=current_user.id,
        new_data={
            "loan_id": str(loan.id),
            "loan_number": loan.loan_number,
            "loan_status_after": loan.status.value,
            "auto_proposed": False,
            "reason_length": len(payload.proposed_reason or ""),
        },
        request=request,
    )
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
    # Join loan + customer so the cross-loan review queue can render each row
    # (who / which loan / principal) without a per-row lookup. Excludes rows
    # whose loan or customer was soft-deleted.
    q = (
        db.query(BadDebtProposal, Loan, Customer)
        .join(Loan, Loan.id == BadDebtProposal.loan_id)
        .join(Customer, Customer.id == Loan.customer_id)
        .filter(
            BadDebtProposal.is_deleted.is_(False),
            Loan.is_deleted.is_(False),
            Customer.is_deleted.is_(False),
        )
    )
    if status_filter:
        q = q.filter(BadDebtProposal.status == status_filter)
    total = q.count()
    rows = (
        q.order_by(BadDebtProposal.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    results = [
        BadDebtProposalListItem(
            **BadDebtProposalResponse.model_validate(proposal).model_dump(),
            loan_number=loan.loan_number,
            loan_status=loan.status,
            principal=loan.principal,
            customer_id=customer.id,
            customer_name=customer.full_name,
            customer_mobile=customer.mobile_number,
        )
        for proposal, loan, customer in rows
    ]
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
    request: Request,
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

    old_proposal_status = proposal.status.value
    old_loan_status = loan.status.value
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

    # B1: record who reviewed, the decision, and the resulting loan
    # status. Review note length only (notes can contain customer PII).
    write_audit(
        db,
        action_type="BAD_DEBT_REVIEW",
        target_table="bad_debt_proposals",
        record_id=proposal.id,
        user_id=current_user.id,
        old_data={
            "proposal_status": old_proposal_status,
            "loan_status": old_loan_status,
        },
        new_data={
            "proposal_status": proposal.status.value,
            "loan_status": loan.status.value,
            "decision": payload.decision,
            "review_notes_length": len(payload.review_notes or ""),
        },
        request=request,
    )
    db.commit()
    db.refresh(proposal)
    return proposal
