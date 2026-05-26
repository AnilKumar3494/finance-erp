import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.config import settings
from app.core.rate_limit import limiter
from app.dependencies.access import assert_loan_access
from app.dependencies.auth import get_current_user, require_admin
from app.dependencies.cache import no_store
from app.models.loan import Loan
from app.models.user import User
from app.schemas.personnel import (
    LoanPersonnelCreate,
    LoanPersonnelListResponse,
    LoanPersonnelResponse,
    PersonnelCreate,
    PersonnelLookupResult,
    PersonnelResponse,
    PersonnelUnmaskedPII,
    PersonnelUpdate,
)
from app.services.personnel import (
    add_to_loan,
    create_personnel,
    get_loan_personnel_record,
    get_personnel,
    list_loan_personnel,
    lookup_personnel,
    remove_from_loan,
    soft_delete_personnel,
    update_personnel,
)
from app.utils.audit import write_audit

personnel_router = APIRouter(prefix="/personnel", tags=["Personnel"])
loan_personnel_router = APIRouter(prefix="/loans", tags=["Personnel"])


# Centralized in app/dependencies/access.py. Existing call sites stay
# as-is; only the implementation moves.
def _ensure_loan_access(db: Session, loan: Loan, current_user: User) -> None:
    assert_loan_access(loan, current_user, db)


# --------------------------------------------------
# LOOKUP (must be before /{personnel_id} to avoid route conflict)
# --------------------------------------------------
@personnel_router.get(
    "/lookup",
    response_model=PersonnelLookupResult,
    summary="Look up a person by mobile, Aadhaar, or PAN — returns existing loan associations",
)
@limiter.limit(settings.RATE_LIMIT_LOOKUP)
def lookup(
    request: Request,
    mobile_number: Optional[str] = Query(None),
    aadhaar_number: Optional[str] = Query(None),
    pan_number: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not any([mobile_number, aadhaar_number, pan_number]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide at least one of: mobile_number, aadhaar_number, pan_number",
        )

    person, associations = lookup_personnel(
        db,
        mobile_number=mobile_number,
        aadhaar_number=aadhaar_number,
        pan_number=pan_number,
    )

    # Audit the probe (which identifiers were used — never the values).
    write_audit(
        db,
        action_type="PERSONNEL_LOOKUP",
        target_table="personnel",
        record_id=person.id if person else None,
        user_id=current_user.id,
        new_data={
            "by": [
                k
                for k, v in (
                    ("mobile_number", mobile_number),
                    ("aadhaar_number", aadhaar_number),
                    ("pan_number", pan_number),
                )
                if v
            ],
            "found": person is not None,
        },
        request=request,
    )
    db.commit()

    if not person:
        return PersonnelLookupResult(found=False)

    return PersonnelLookupResult(
        found=True,
        personnel=PersonnelResponse.model_validate(person),
        existing_loan_associations=associations,
    )


# --------------------------------------------------
# CREATE
# --------------------------------------------------
@personnel_router.post(
    "/",
    response_model=PersonnelResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new guarantor or co-hirer record",
)
def create(
    request: Request,
    payload: PersonnelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return create_personnel(
            db=db, data=payload, created_by=current_user.id, request=request
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


# --------------------------------------------------
# GET BY ID
# --------------------------------------------------
@personnel_router.get(
    "/{personnel_id}",
    response_model=PersonnelResponse,
    summary="Get a personnel record by ID",
)
def get_one(
    personnel_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    person = get_personnel(db, personnel_id)
    if not person:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return person


# --------------------------------------------------
# UNMASK PII (Admin Only) — audited
# --------------------------------------------------
@personnel_router.get(
    "/{personnel_id}/unmask",
    response_model=PersonnelUnmaskedPII,
    summary="Get unmasked Aadhaar/PAN for a person (Admin Only)",
    dependencies=[Depends(no_store)],
)
def get_unmasked_pii(
    request: Request,
    personnel_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # SECURITY: Admins only
):
    """Every unmask is recorded in audit_logs (NBFC compliance)."""
    person = get_personnel(db, personnel_id)
    if not person:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    write_audit(
        db,
        action_type="PII_UNMASK",
        target_table="personnel",
        record_id=person.id,
        user_id=current_user.id,
        new_data={"fields": ["aadhaar_number", "pan_number"]},
        request=request,
    )
    db.commit()

    return PersonnelUnmaskedPII(
        aadhaar_number=person.aadhaar_number, pan_number=person.pan_number
    )


# --------------------------------------------------
# UPDATE
# --------------------------------------------------
@personnel_router.patch(
    "/{personnel_id}",
    response_model=PersonnelResponse,
    summary="Update a personnel record",
)
def update(
    request: Request,
    personnel_id: uuid.UUID,
    payload: PersonnelUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    person = get_personnel(db, personnel_id)
    if not person:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    try:
        return update_personnel(
            db=db, person=person, data=payload, updated_by=current_user.id,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


# --------------------------------------------------
# SOFT DELETE (Admin only)
# --------------------------------------------------
@personnel_router.delete(
    "/{personnel_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft delete a personnel record (Admin Only)",
)
def delete(
    request: Request,
    personnel_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    person = get_personnel(db, personnel_id)
    if not person:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    try:
        soft_delete_personnel(
            db=db, person=person, deleted_by=current_user.id, request=request
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


# --------------------------------------------------
# ADD PERSONNEL TO LOAN
# --------------------------------------------------
@loan_personnel_router.post(
    "/{loan_id}/personnel",
    response_model=LoanPersonnelResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a guarantor or co-hirer to a loan",
)
def add_personnel_to_loan(
    request: Request,
    loan_id: uuid.UUID,
    payload: LoanPersonnelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )

    _ensure_loan_access(db, loan, current_user)

    person = get_personnel(db, payload.personnel_id)
    if not person:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Personnel not found"
        )

    try:
        return add_to_loan(
            db=db, loan_id=loan_id, data=payload, created_by=current_user.id,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


# --------------------------------------------------
# LIST PERSONNEL FOR A LOAN
# --------------------------------------------------
@loan_personnel_router.get(
    "/{loan_id}/personnel",
    response_model=LoanPersonnelListResponse,
    summary="List all guarantors and co-hirers for a loan",
)
def list_personnel_for_loan(
    loan_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found"
        )

    _ensure_loan_access(db, loan, current_user)

    results = list_loan_personnel(db, loan_id)
    return LoanPersonnelListResponse(
        total=len(results),
        page=1,
        page_size=len(results),
        results=results,
    )


# --------------------------------------------------
# REMOVE PERSONNEL FROM LOAN (Admin only)
# --------------------------------------------------
@loan_personnel_router.delete(
    "/{loan_id}/personnel/{loan_personnel_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a guarantor or co-hirer from a loan",
)
def remove_personnel_from_loan(
    request: Request,
    loan_id: uuid.UUID,
    loan_personnel_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    record = get_loan_personnel_record(db, loan_personnel_id)
    if not record or record.loan_id != loan_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Record not found"
        )
    remove_from_loan(
        db=db, record=record, deleted_by=current_user.id, request=request
    )
