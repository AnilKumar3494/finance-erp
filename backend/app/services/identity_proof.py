"""
Identity Proof service.

Atomicity: every mutation writes its audit row INSIDE the same try
block as the flush, and commits once at the end. See
`app/services/stability_document.py` header for the rationale.
"""
import uuid
from typing import Optional

from fastapi import Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.document import DocCategory
from app.models.identity_proof import IdentityProof
from app.schemas.identity_proof import (
    IdentityProofCreate,
    _normalize_and_validate_id_number,
)
from app.utils.audit import write_audit
from app.utils.db_errors import safe_integrity_message
from app.utils.document_link import validate_document_link


def _audit_payload(proof: IdentityProof, *, entity_type: Optional[str] = None) -> dict:
    """Structural facts only — never the raw id_number (PII)."""
    return {
        "entity_type": entity_type
        or ("customer" if proof.customer_id else "personnel"),
        "customer_id": str(proof.customer_id) if proof.customer_id else None,
        "personnel_id": str(proof.personnel_id) if proof.personnel_id else None,
        "proof_type": proof.proof_type.value,
        "has_id_number": proof.id_number is not None,
        "document_id": str(proof.document_id) if proof.document_id else None,
    }


def create_identity_proof(
    db: Session,
    data: IdentityProofCreate,
    created_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> IdentityProof:
    customer_id = data.entity_id if data.entity_type == "customer" else None
    personnel_id = data.entity_id if data.entity_type == "personnel" else None

    # Documents are owned by a customer (NOT NULL since migration 009).
    # Personnel-branch attachments would let a guarantor reuse some
    # customer's KYC scan — reject until a personnel-document data
    # model exists. Customer-branch validates against the proof's
    # customer_id via the shared helper.
    if data.document_id is not None:
        if data.entity_type == "personnel":
            raise ValueError(
                "Attaching a document to a personnel identity proof is not "
                "yet supported. File the proof without document_id, or "
                "upload the document against the customer record instead."
            )
        validate_document_link(
            db,
            data.document_id,
            expected_doc_type=DocCategory.IDENTITY_PROOF,
            expected_customer_id=customer_id,
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
        db.flush()
        write_audit(
            db,
            action_type="IDENTITY_PROOF_CREATE",
            target_table="identity_proofs",
            record_id=proof.id,
            user_id=created_by,
            new_data=_audit_payload(proof, entity_type=data.entity_type),
            request=request,
        )
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e)) from None

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
    request: Optional[Request] = None,
) -> IdentityProof:
    """Update `id_number` only. proof_type / owning entity are immutable.

    The format validator runs against the row's existing proof_type so a
    caller cannot smuggle in a 12-digit number under a PAN proof.
    """
    before_present = proof.id_number is not None
    proof.id_number = _normalize_and_validate_id_number(proof.proof_type, new_id_number)
    proof.updated_by_id = updated_by
    try:
        db.flush()
        write_audit(
            db,
            action_type="IDENTITY_PROOF_UPDATE",
            target_table="identity_proofs",
            record_id=proof.id,
            user_id=updated_by,
            old_data={"had_id_number": before_present},
            new_data={"has_id_number": proof.id_number is not None},
            request=request,
        )
        db.commit()
        db.refresh(proof)
        return proof
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e)) from None


def delete_identity_proof(
    db: Session,
    proof: IdentityProof,
    deleted_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> None:
    snapshot = _audit_payload(proof)
    # Centralized soft-delete: keeps is_deleted/deleted_at in sync (satisfies
    # the check_soft_delete_identity_proofs CHECK) and also sets updated_by_id.
    proof.soft_delete(deleted_by)
    db.flush()
    write_audit(
        db,
        action_type="IDENTITY_PROOF_DELETE",
        target_table="identity_proofs",
        record_id=proof.id,
        user_id=deleted_by,
        old_data=snapshot,
        request=request,
    )
    db.commit()
