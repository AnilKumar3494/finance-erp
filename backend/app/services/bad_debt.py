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


class DuplicateProposalError(ValueError):
    """Raised when an open proposal already exists for the loan.

    Dedicated subclass so callers (like auto_propose_bad_debt) can recover
    from this specific race without swallowing other real precondition
    errors (e.g. trying to propose on a CLOSED loan).
    """


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
        raise DuplicateProposalError("A bad-debt proposal is already open for this loan")

    # Scope the insert + loan-status change inside a savepoint so a race
    # with another concurrent proposer rolls back ONLY this block — not
    # any earlier work the caller has already done in the same transaction
    # (e.g. the cap path in apply_penalty has already written the penalty
    # event by the time this is invoked).
    sp = db.begin_nested()
    try:
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

        db.flush()
        sp.commit()
    except IntegrityError:
        sp.rollback()
        raise DuplicateProposalError(
            "A bad-debt proposal is already open for this loan"
        )
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


def reopen_proposal(
    db: Session,
    proposal: BadDebtProposal,
    loan: Loan,
    reviewer_id: uuid.UUID,
) -> BadDebtProposal:
    """
    Undo an APPROVED review decision — the proposal returns to PROPOSED so it
    re-enters the review queue. The loan is left BAD_DEBT_PROPOSED (approve
    never changed it), so there's no loan-status change. Caller holds the loan
    lock.

    Guarded by the one-open-proposal-per-loan rule: refuse if another PROPOSED
    row somehow already exists for this loan (the partial unique index would
    reject the write anyway).
    """
    if proposal.status != BadDebtProposalStatus.APPROVED:
        raise ValueError(
            f"Only an APPROVED proposal can be reopened; this one is "
            f"{proposal.status.value}"
        )
    if loan.status != LoanStatus.BAD_DEBT_PROPOSED:
        raise ValueError(
            f"Cannot reopen — loan is {loan.status.value}, not BAD_DEBT_PROPOSED"
        )

    existing = get_open_proposal(db, loan.id)
    if existing is not None and existing.id != proposal.id:
        raise DuplicateProposalError(
            "Another open proposal already exists for this loan"
        )

    # Clear the prior review so the row reads as genuinely pending again.
    proposal.status = BadDebtProposalStatus.PROPOSED
    proposal.reviewed_by_id = None
    proposal.reviewed_at = None
    proposal.review_notes = None
    proposal.updated_by_id = reviewer_id
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
    except DuplicateProposalError:
        # Race with another proposer — refetch and return. Other ValueErrors
        # (e.g. loan is CLOSED / BAD_DEBT) propagate so callers see them.
        return get_open_proposal(db, loan.id)
