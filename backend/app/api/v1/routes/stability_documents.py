import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin
from app.models.loan import Loan
from app.models.user import User, UserRole
from app.schemas.stability_document import (
    StabilityDocumentCreate,
    StabilityDocumentListResponse,
    StabilityDocumentResponse,
)
from app.services.stability_document import (
    create_stability_document,
    delete_stability_document,
    get_stability_document,
    list_stability_documents,
)

router = APIRouter(prefix="/loans", tags=["Stability Documents"])


def _get_loan_with_access_check(
    loan_id: uuid.UUID, db: Session, current_user: User
) -> Loan:
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )
    if current_user.role == UserRole.EMPLOYEE:
        from app.models.customer import Customer
        customer = db.query(Customer).filter(Customer.id == loan.customer_id).first()
        if not customer or customer.assigned_employee_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")
    return loan


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
    loan_id: uuid.UUID,
    payload: StabilityDocumentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_loan_with_access_check(loan_id, db, current_user)
    return create_stability_document(
        db=db, loan_id=loan_id, data=payload, created_by=current_user.id
    )


# --------------------------------------------------
# LIST
# --------------------------------------------------
@router.get(
    "/{loan_id}/stability-docs",
    response_model=StabilityDocumentListResponse,
    summary="List all stability documents for a loan",
)
def list_all(
    loan_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_loan_with_access_check(loan_id, db, current_user)
    results = list_stability_documents(db, loan_id)
    return StabilityDocumentListResponse(total=len(results), results=results)


# --------------------------------------------------
# DELETE (Admin only)
# --------------------------------------------------
@router.delete(
    "/{loan_id}/stability-docs/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft delete a stability document",
)
def delete(
    loan_id: uuid.UUID,
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    doc = get_stability_document(db, doc_id)
    if not doc or doc.loan_id != loan_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    delete_stability_document(db=db, doc=doc, deleted_by=current_user.id)
