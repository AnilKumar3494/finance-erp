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
from app.utils.audit import write_audit

router = APIRouter(prefix="/loans", tags=["Stability Documents"])

# NOTE on dependency declarations: `loan_for_user` already depends on
# `get_current_user`. Re-declaring `current_user = Depends(get_current_user)`
# in the same route does NOT cause a duplicate auth check — FastAPI dedupes
# identical sub-dependencies for a given request. Declaring both lets each
# handler see both the loan and the user without juggling Request manually.


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
            db=db, loan_id=loan.id, data=payload, created_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))

    write_audit(
        db,
        action_type="STABILITY_DOC_CREATE",
        target_table="stability_documents",
        record_id=doc.id,
        user_id=current_user.id,
        new_data={
            "loan_id": str(loan.id),
            "doc_subtype": doc.doc_subtype.value,
            "cheque_count": doc.cheque_count,
            "has_description": doc.description is not None,
            "document_id": str(doc.document_id) if doc.document_id else None,
        },
        request=request,
    )
    db.commit()
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

    before = {
        "cheque_count": doc.cheque_count,
        "had_description": doc.description is not None,
    }
    try:
        updated = update_stability_document(
            db, doc, payload, updated_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    write_audit(
        db,
        action_type="STABILITY_DOC_UPDATE",
        target_table="stability_documents",
        record_id=updated.id,
        user_id=current_user.id,
        old_data=before,
        new_data={
            "cheque_count": updated.cheque_count,
            "has_description": updated.description is not None,
        },
        request=request,
    )
    db.commit()
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

    snapshot = {
        "doc_subtype": doc.doc_subtype.value,
        "loan_id": str(doc.loan_id),
    }
    delete_stability_document(db=db, doc=doc, deleted_by=current_user.id)

    write_audit(
        db,
        action_type="STABILITY_DOC_DELETE",
        target_table="stability_documents",
        record_id=doc.id,
        user_id=current_user.id,
        old_data=snapshot,
        request=request,
    )
    db.commit()
