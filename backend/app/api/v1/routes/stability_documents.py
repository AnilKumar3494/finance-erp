import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.access import loan_for_user
from app.dependencies.auth import get_current_user, require_admin
from app.models.loan import Loan
from app.models.user import User
from app.schemas.stability_document import (
    StabilityDocumentCreate,
    StabilityDocumentListResponse,
    StabilityDocumentResponse,
    StabilityDocumentUpdate,
)
from app.services.stability_document import (
    create_stability_document,
    delete_stability_document,
    get_stability_document,
    list_stability_documents,
    update_stability_document,
)

router = APIRouter(prefix="/loans", tags=["Stability Documents"])

# NOTE on audit: the service layer writes the audit row inside the same
# transaction as the mutation (see app/services/stability_document.py).
# Route handlers no longer call write_audit themselves.


# --------------------------------------------------
# CREATE
# --------------------------------------------------
@router.post(
    "/{loan_id}/stability-docs",
    response_model=StabilityDocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a stability verification document to a loan",
)
def create(
    request: Request,
    payload: StabilityDocumentCreate,
    loan: Loan = Depends(loan_for_user),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        doc = create_stability_document(
            db=db,
            loan_id=loan.id,
            data=payload,
            created_by=current_user.id,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return StabilityDocumentResponse.model_validate(doc)


# --------------------------------------------------
# LIST
# --------------------------------------------------
@router.get(
    "/{loan_id}/stability-docs",
    response_model=StabilityDocumentListResponse,
    summary="List all stability documents for a loan",
)
def list_all(
    loan: Loan = Depends(loan_for_user),
    db: Session = Depends(get_db),
):
    results = list_stability_documents(db, loan.id)
    return StabilityDocumentListResponse(
        total=len(results),
        page=1,
        page_size=len(results),
        results=[StabilityDocumentResponse.model_validate(r) for r in results],
    )


# --------------------------------------------------
# UPDATE (Admin only)
# --------------------------------------------------
@router.patch(
    "/{loan_id}/stability-docs/{doc_id}",
    response_model=StabilityDocumentResponse,
    summary="Update description / cheque_count on a stability document",
)
def update(
    request: Request,
    doc_id: uuid.UUID,
    payload: StabilityDocumentUpdate,
    loan: Loan = Depends(loan_for_user),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    doc = get_stability_document(db, doc_id)
    if not doc or doc.loan_id != loan.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    try:
        updated = update_stability_document(
            db, doc, payload, updated_by=current_user.id, request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return StabilityDocumentResponse.model_validate(updated)


# --------------------------------------------------
# DELETE (Admin only)
# --------------------------------------------------
@router.delete(
    "/{loan_id}/stability-docs/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft delete a stability document",
)
def delete(
    request: Request,
    doc_id: uuid.UUID,
    loan: Loan = Depends(loan_for_user),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    doc = get_stability_document(db, doc_id)
    if not doc or doc.loan_id != loan.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    delete_stability_document(
        db=db, doc=doc, deleted_by=current_user.id, request=request,
    )
