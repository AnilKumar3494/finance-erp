import uuid
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.document import DocCategory
from app.models.identity_proof import IdentityProof
from app.schemas.identity_proof import (
    IdentityProofCreate,
    _normalize_and_validate_id_number,
)
from app.utils.db_errors import safe_integrity_message
from app.utils.document_link import validate_document_link


def create_identity_proof(
    db: Session, data: IdentityProofCreate, created_by: uuid.UUID
) -> IdentityProof:
    customer_id = data.entity_id if data.entity_type == "customer" else None
    personnel_id = data.entity_id if data.entity_type == "personnel" else None

    # If a document is being attached, prove it is real, active, of the
    # correct category, and (for the customer branch) belongs to the same
    # customer. Without this a caller can attach any document UUID — even
    # another customer's KYC.
    if data.document_id is not None:
        validate_document_link(
            db,
            data.document_id,
            expected_doc_type=DocCategory.IDENTITY_PROOF,
            expected_customer_id=customer_id,
            # No loan-scope check for personnel branch — IDENTITY_PROOF
            # documents do not carry a loan_id by design.
        )

    proof = IdentityProof(
        customer_id=customer_id,
        personnel_id=personnel_id,
        proof_type=data.proof_type,
        id_number=data.id_number,
        document_id=data.document_id,
        created_by_id=created_by,
    )
    db.add(proof)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e)) from None

    # Re-fetch with the nested document eager-loaded so the response can
    # render file_name / content_type without a second round-trip.
    return (
        db.query(IdentityProof)
        .options(joinedload(IdentityProof.document))
        .filter(IdentityProof.id == proof.id)
        .first()
    )


def get_identity_proof(db: Session, proof_id: uuid.UUID) -> Optional[IdentityProof]:
    return (
        db.query(IdentityProof)
        .options(joinedload(IdentityProof.document))
        .filter(
            IdentityProof.id == proof_id, IdentityProof.is_deleted == False  # noqa: E712
        )
        .first()
    )


def list_identity_proofs(
    db: Session,
    customer_id: Optional[uuid.UUID] = None,
    personnel_id: Optional[uuid.UUID] = None,
) -> list[IdentityProof]:
    query = (
        db.query(IdentityProof)
        .options(joinedload(IdentityProof.document))
        .filter(IdentityProof.is_deleted == False)  # noqa: E712
    )
    if customer_id:
        query = query.filter(IdentityProof.customer_id == customer_id)
    if personnel_id:
        query = query.filter(IdentityProof.personnel_id == personnel_id)
    return query.order_by(IdentityProof.created_at).all()


def update_identity_proof_number(
    db: Session,
    proof: IdentityProof,
    *,
    new_id_number: Optional[str],
    updated_by: uuid.UUID,
) -> IdentityProof:
    """Update `id_number` only. proof_type / owning entity are immutable.

    The format validator runs against the row's existing proof_type so a
    caller cannot smuggle in a 12-digit number under a PAN proof.
    """
    proof.id_number = _normalize_and_validate_id_number(proof.proof_type, new_id_number)
    proof.updated_by_id = updated_by
    try:
        db.commit()
        db.refresh(proof)
        return proof
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e)) from None


def delete_identity_proof(
    db: Session, proof: IdentityProof, deleted_by: uuid.UUID
) -> None:
    # Centralized soft-delete: keeps is_deleted/deleted_at in sync (satisfies
    # the check_soft_delete_identity_proofs CHECK) and also sets updated_by_id.
    proof.soft_delete(deleted_by)
    db.commit()
