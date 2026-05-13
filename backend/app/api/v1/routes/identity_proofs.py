import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin
from app.models.customer import Customer
from app.models.user import User, UserRole
from app.schemas.identity_proof import (
    IdentityProofCreate,
    IdentityProofListResponse,
    IdentityProofResponse,
)
from app.services.identity_proof import (
    create_identity_proof,
    delete_identity_proof,
    get_identity_proof,
    list_identity_proofs,
)
from app.services.personnel import get_personnel

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
    payload: IdentityProofCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Validate the entity exists
    if payload.entity_type == "customer":
        entity = (
            db.query(Customer)
            .filter(Customer.id == payload.entity_id, Customer.is_deleted == False)
            .first()
        )
        if not entity:
            raise HTTPException(status_code=404, detail="Customer not found")
        if (
            current_user.role == UserRole.EMPLOYEE
            and entity.assigned_employee_id != current_user.id
        ):
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        entity = get_personnel(db, payload.entity_id)
        if not entity:
            raise HTTPException(status_code=404, detail="Personnel not found")

    return create_identity_proof(db=db, data=payload, created_by=current_user.id)


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
    if not customer_id and not personnel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either customer_id or personnel_id",
        )

    if customer_id and current_user.role == UserRole.EMPLOYEE:
        customer = (
            db.query(Customer)
            .filter(Customer.id == customer_id, Customer.is_deleted == False)
            .first()
        )
        if not customer or customer.assigned_employee_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")

    results = list_identity_proofs(
        db, customer_id=customer_id, personnel_id=personnel_id
    )
    return IdentityProofListResponse(total=len(results), results=results)


# --------------------------------------------------
# DELETE (Admin only)
# --------------------------------------------------
@router.delete(
    "/{proof_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft delete an identity proof",
)
def delete(
    proof_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    proof = get_identity_proof(db, proof_id)
    if not proof:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    delete_identity_proof(db=db, proof=proof, deleted_by=current_user.id)
