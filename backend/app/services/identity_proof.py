import uuid
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.identity_proof import IdentityProof, IdentityProofType
from app.schemas.identity_proof import IdentityProofCreate
from app.utils.db_errors import safe_integrity_message


def create_identity_proof(
    db: Session, data: IdentityProofCreate, created_by: uuid.UUID
) -> IdentityProof:
    customer_id = data.entity_id if data.entity_type == "customer" else None
    personnel_id = data.entity_id if data.entity_type == "personnel" else None

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
        db.refresh(proof)
        return proof
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e))


def get_identity_proof(db: Session, proof_id: uuid.UUID) -> Optional[IdentityProof]:
    return (
        db.query(IdentityProof)
        .filter(IdentityProof.id == proof_id, IdentityProof.is_deleted == False)
        .first()
    )


def list_identity_proofs(
    db: Session,
    customer_id: Optional[uuid.UUID] = None,
    personnel_id: Optional[uuid.UUID] = None,
) -> list[IdentityProof]:
    query = db.query(IdentityProof).filter(IdentityProof.is_deleted == False)
    if customer_id:
        query = query.filter(IdentityProof.customer_id == customer_id)
    if personnel_id:
        query = query.filter(IdentityProof.personnel_id == personnel_id)
    return query.order_by(IdentityProof.created_at).all()


def delete_identity_proof(
    db: Session, proof: IdentityProof, deleted_by: uuid.UUID
) -> None:
    # Centralized soft-delete: keeps is_deleted/deleted_at in sync (satisfies
    # the check_soft_delete_identity_proofs CHECK) and also sets updated_by_id.
    proof.soft_delete(deleted_by)
    db.commit()
