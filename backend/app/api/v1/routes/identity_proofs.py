import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.access import assert_customer_access
from app.dependencies.auth import get_current_user, require_admin
from app.models.customer import Customer
from app.models.user import User, UserRole
from app.schemas.identity_proof import (
    IdentityProofCreate,
    IdentityProofListResponse,
    IdentityProofResponse,
    IdentityProofUpdate,
)
from app.services.identity_proof import (
    create_identity_proof,
    delete_identity_proof,
    get_identity_proof,
    list_identity_proofs,
    update_identity_proof_number,
)
from app.services.personnel import get_personnel
from app.utils.audit import write_audit

router = APIRouter(prefix="/identity-proofs", tags=["Identity Proofs"])


# --------------------------------------------------
# CREATE
# --------------------------------------------------
@router.post(
    "/",
    response_model=IdentityProofResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add an identity proof for a customer or personnel",
)
def create(
    request: Request,
    payload: IdentityProofCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Validate the entity exists, and apply access rules.
    if payload.entity_type == "customer":
        entity = (
            db.query(Customer)
            .filter(
                Customer.id == payload.entity_id,
                Customer.is_deleted == False,  # noqa: E712
            )
            .first()
        )
        if not entity:
            raise HTTPException(status_code=404, detail="Customer not found")
        assert_customer_access(entity, current_user)
    else:
        # Personnel branch: shared across loans, but we keep create
        # admin-only for MVP. An EMPLOYEE can still record a personnel's
        # identity proof by first attaching the personnel to one of their
        # loans, then asking an admin to file the proof — this avoids the
        # "any employee can plant a fake proof on any personnel" hole.
        if current_user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admins may file identity proofs against personnel",
            )
        entity = get_personnel(db, payload.entity_id)
        if not entity:
            raise HTTPException(status_code=404, detail="Personnel not found")

    try:
        proof = create_identity_proof(db=db, data=payload, created_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))

    write_audit(
        db,
        action_type="IDENTITY_PROOF_CREATE",
        target_table="identity_proofs",
        record_id=proof.id,
        user_id=current_user.id,
        new_data={
            "entity_type": payload.entity_type,
            "entity_id": str(payload.entity_id),
            "proof_type": proof.proof_type.value,
            # Never log raw id_number — that defeats the PII-masking effort.
            "has_id_number": proof.id_number is not None,
            "document_id": str(proof.document_id) if proof.document_id else None,
        },
        request=request,
    )
    db.commit()
    return IdentityProofResponse.from_orm_for_user(proof, user=current_user)


# --------------------------------------------------
# LIST
# --------------------------------------------------
@router.get(
    "/",
    response_model=IdentityProofListResponse,
    summary="List identity proofs — filter by customer_id or personnel_id",
)
def list_all(
    customer_id: Optional[uuid.UUID] = Query(None),
    personnel_id: Optional[uuid.UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Exactly one filter required. An identity proof is owned by exactly one
    # entity (DB CHECK ck_identity_proof_owner) so AND-filtering both is
    # meaningless. Collapse "neither" and "both" into one clear 400.
    if bool(customer_id) == bool(personnel_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide exactly one of customer_id or personnel_id",
        )

    # Customer branch is RBAC-scoped. Personnel branch is open to any
    # authenticated user (personnel are shared across loans), but the
    # response mask in `from_orm_for_user` hides id_number from non-admins
    # so personnel listing can't be used to enumerate PII.
    if customer_id and current_user.role == UserRole.EMPLOYEE:
        customer = (
            db.query(Customer)
            .filter(
                Customer.id == customer_id, Customer.is_deleted == False  # noqa: E712
            )
            .first()
        )
        if not customer or customer.assigned_employee_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")

    results = list_identity_proofs(
        db, customer_id=customer_id, personnel_id=personnel_id
    )
    return IdentityProofListResponse(
        total=len(results),
        page=1,
        page_size=len(results),
        results=[
            IdentityProofResponse.from_orm_for_user(r, user=current_user)
            for r in results
        ],
    )


# --------------------------------------------------
# UPDATE id_number (Admin only)
# --------------------------------------------------
@router.patch(
    "/{proof_id}",
    response_model=IdentityProofResponse,
    summary="Update the id_number on an identity proof (Admin only)",
)
def update(
    request: Request,
    proof_id: uuid.UUID,
    payload: IdentityProofUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    proof = get_identity_proof(db, proof_id)
    if not proof:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    before_present = proof.id_number is not None
    try:
        updated = update_identity_proof_number(
            db,
            proof,
            new_id_number=payload.id_number,
            updated_by=current_user.id,
        )
    except ValueError as e:
        # ValueError surfaces both format errors (from the schema validator)
        # and DB integrity errors — both are caller-fixable, so 400.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    write_audit(
        db,
        action_type="IDENTITY_PROOF_UPDATE",
        target_table="identity_proofs",
        record_id=updated.id,
        user_id=current_user.id,
        old_data={"had_id_number": before_present},
        new_data={"has_id_number": updated.id_number is not None},
        request=request,
    )
    db.commit()
    return IdentityProofResponse.from_orm_for_user(updated, user=current_user)


# --------------------------------------------------
# DELETE (Admin only)
# --------------------------------------------------
@router.delete(
    "/{proof_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft delete an identity proof",
)
def delete(
    request: Request,
    proof_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    proof = get_identity_proof(db, proof_id)
    if not proof:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    snapshot = {
        "proof_type": proof.proof_type.value,
        "customer_id": str(proof.customer_id) if proof.customer_id else None,
        "personnel_id": str(proof.personnel_id) if proof.personnel_id else None,
    }
    delete_identity_proof(db=db, proof=proof, deleted_by=current_user.id)

    write_audit(
        db,
        action_type="IDENTITY_PROOF_DELETE",
        target_table="identity_proofs",
        record_id=proof.id,
        user_id=current_user.id,
        old_data=snapshot,
        request=request,
    )
    db.commit()
