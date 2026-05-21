"""
Bad-debt proposal service.

Workflow:
  - EMPLOYEE or higher can PROPOSE a loan for bad debt with a reason.
  - The penalty engine auto-proposes when the penalty cap is hit
    (via `auto_propose_bad_debt` invoked from the cap-detection code path).
  - ADMIN or SUPER_ADMIN reviews:
      APPROVE → loan goes to BAD_DEBT (formal write-off via /close is still
                an admin choice; this just marks the loan terminal-eligible).
      REJECT  → proposal is rejected; loan returns to ACTIVE.

  At most one PROPOSED row per loan at a time (DB-enforced).
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.bad_debt_proposal import BadDebtProposal, BadDebtProposalStatus
from app.models.loan import Loan, LoanStatus


def get_open_proposal(db: Session, loan_id: uuid.UUID) -> Optional[BadDebtProposal]:
    return (
        db.query(BadDebtProposal)
        .filter(
            BadDebtProposal.loan_id == loan_id,
            BadDebtProposal.status == BadDebtProposalStatus.PROPOSED,
            BadDebtProposal.is_deleted.is_(False),
        )
        .first()
    )


def propose_bad_debt(
    db: Session,
    loan: Loan,
    proposed_by: Optional[uuid.UUID],
    reason: str,
    auto: bool = False,
) -> BadDebtProposal:
    """
    Create a new BAD_DEBT proposal. Caller must hold the loan lock.

    Side-effects: loan.status → BAD_DEBT_PROPOSED.
    """
    if loan.status in (LoanStatus.BAD_DEBT, LoanStatus.CLOSED):
        raise ValueError(
            f"Cannot propose bad debt — loan is {loan.status.value}"
        )

    existing = get_open_proposal(db, loan.id)
    if existing is not None:
        raise ValueError("A bad-debt proposal is already open for this loan")

    proposal = BadDebtProposal(
        loan_id=loan.id,
        status=BadDebtProposalStatus.PROPOSED,
        proposed_reason=reason,
        proposed_by_id=None if auto else proposed_by,
        auto_proposed=auto,
        created_by_id=proposed_by,
    )
    db.add(proposal)

    loan.status = LoanStatus.BAD_DEBT_PROPOSED
    loan.updated_by_id = proposed_by

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ValueError("A bad-debt proposal is already open for this loan")
    return proposal


def review_proposal(
    db: Session,
    proposal: BadDebtProposal,
    loan: Loan,
    decision: str,  # "APPROVE" | "REJECT"
    reviewer_id: uuid.UUID,
    review_notes: Optional[str] = None,
) -> BadDebtProposal:
    """
    Admin/Super-Admin decision. Caller holds the loan lock.

    APPROVE → loan stays BAD_DEBT_PROPOSED (admin can then write-off via
              /loans/{id}/close with closure_type=WRITE_OFF to reach BAD_DEBT).
              The proposal itself transitions to APPROVED.
    REJECT  → loan reverts to ACTIVE; proposal goes to REJECTED.
    """
    if proposal.status != BadDebtProposalStatus.PROPOSED:
        raise ValueError(
            f"Proposal is already {proposal.status.value}; cannot review again"
        )
    if decision not in ("APPROVE", "REJECT"):
        raise ValueError("decision must be APPROVE or REJECT")

    now = datetime.now(timezone.utc)
    proposal.reviewed_by_id = reviewer_id
    proposal.reviewed_at = now
    proposal.review_notes = review_notes
    proposal.updated_by_id = reviewer_id

    if decision == "APPROVE":
        proposal.status = BadDebtProposalStatus.APPROVED
        # Loan stays BAD_DEBT_PROPOSED until admin executes WRITE_OFF close.
    else:
        proposal.status = BadDebtProposalStatus.REJECTED
        loan.status = LoanStatus.ACTIVE
        loan.updated_by_id = reviewer_id

    return proposal


def auto_propose_bad_debt(
    db: Session,
    loan: Loan,
    reason: str,
    system_actor_id: Optional[uuid.UUID],
) -> Optional[BadDebtProposal]:
    """
    Idempotent: if a PROPOSED row already exists, return it (no-op).
    Otherwise create one with auto_proposed=True. Used by the penalty cap
    path and the nightly job. system_actor_id may be None (e.g. when the
    nightly job is the actor — no current user).
    """
    existing = get_open_proposal(db, loan.id)
    if existing is not None:
        return existing
    try:
        return propose_bad_debt(
            db,
            loan,
            proposed_by=system_actor_id,  # None is allowed (column is nullable)
            reason=reason,
            auto=True,
        )
    except ValueError:
        # Race with another proposer — refetch and return.
        return get_open_proposal(db, loan.id)
