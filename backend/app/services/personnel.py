import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.personnel import Personnel, LoanPersonnel, PersonnelRole
from app.models.loan import Loan
from app.models.customer import Customer
from app.schemas.personnel import (
    PersonnelCreate,
    PersonnelUpdate,
    LoanPersonnelCreate,
    LoanAssociationSummary,
)


def get_personnel(db: Session, personnel_id: uuid.UUID) -> Optional[Personnel]:
    return (
        db.query(Personnel)
        .filter(Personnel.id == personnel_id, Personnel.is_deleted == False)
        .first()
    )


def create_personnel(
    db: Session, data: PersonnelCreate, created_by: uuid.UUID
) -> Personnel:
    person = Personnel(
        full_name=data.full_name,
        mobile_number=data.mobile_number,
        date_of_birth=data.date_of_birth,
        alt_mobile_number=data.alt_mobile_number,
        aadhaar_number=data.aadhaar_number,
        pan_number=data.pan_number,
        address_line_1=data.address_line_1,
        address_line_2=data.address_line_2,
        mandal_village=data.mandal_village,
        remarks=data.remarks,
        created_by_id=created_by,
    )
    db.add(person)
    try:
        db.commit()
        db.refresh(person)
        return person
    except IntegrityError as e:
        db.rollback()
        raise ValueError(f"Duplicate value — {str(e.orig)}")


def update_personnel(
    db: Session, person: Personnel, data: PersonnelUpdate, updated_by: uuid.UUID
) -> Personnel:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(person, field, value)
    person.updated_by_id = updated_by
    try:
        db.commit()
        db.refresh(person)
        return person
    except IntegrityError as e:
        db.rollback()
        raise ValueError(f"Duplicate value — {str(e.orig)}")


def lookup_personnel(
    db: Session,
    mobile_number: Optional[str] = None,
    aadhaar_number: Optional[str] = None,
    pan_number: Optional[str] = None,
) -> tuple[Optional[Personnel], list[LoanAssociationSummary]]:
    conditions = []
    if mobile_number:
        conditions.append(Personnel.mobile_number == mobile_number)
    if aadhaar_number:
        conditions.append(Personnel.aadhaar_number == aadhaar_number)
    if pan_number:
        conditions.append(Personnel.pan_number == pan_number)

    if not conditions:
        return None, []

    person = (
        db.query(Personnel)
        .filter(or_(*conditions), Personnel.is_deleted == False)
        .first()
    )

    if not person:
        return None, []

    rows = (
        db.query(LoanPersonnel, Loan, Customer)
        .join(Loan, LoanPersonnel.loan_id == Loan.id)
        .join(Customer, Loan.customer_id == Customer.id)
        .filter(
            LoanPersonnel.personnel_id == person.id,
            LoanPersonnel.is_deleted == False,
            Loan.is_deleted == False,
        )
        .all()
    )

    associations = [
        LoanAssociationSummary(
            loan_personnel_id=lp.id,
            loan_id=loan.id,
            loan_number=loan.loan_number,
            role=lp.role,
            relationship_to_hirer=lp.relationship_to_hirer,
            customer_name=customer.full_name,
        )
        for lp, loan, customer in rows
    ]

    return person, associations


def get_loan_personnel_record(
    db: Session, loan_personnel_id: uuid.UUID
) -> Optional[LoanPersonnel]:
    return (
        db.query(LoanPersonnel)
        .filter(
            LoanPersonnel.id == loan_personnel_id, LoanPersonnel.is_deleted == False
        )
        .first()
    )


def add_to_loan(
    db: Session,
    loan_id: uuid.UUID,
    data: LoanPersonnelCreate,
    created_by: uuid.UUID,
) -> LoanPersonnel:
    record = LoanPersonnel(
        loan_id=loan_id,
        personnel_id=data.personnel_id,
        role=data.role,
        relationship_to_hirer=data.relationship_to_hirer,
        created_by_id=created_by,
    )
    db.add(record)
    try:
        db.commit()
        db.refresh(record)
        # Reload with personnel relationship eager-loaded
        return (
            db.query(LoanPersonnel)
            .options(joinedload(LoanPersonnel.personnel))
            .filter(LoanPersonnel.id == record.id)
            .first()
        )
    except IntegrityError as e:
        db.rollback()
        raise ValueError(f"Duplicate entry — {str(e.orig)}")


def list_loan_personnel(db: Session, loan_id: uuid.UUID) -> list[LoanPersonnel]:
    return (
        db.query(LoanPersonnel)
        .options(joinedload(LoanPersonnel.personnel))
        .filter(LoanPersonnel.loan_id == loan_id, LoanPersonnel.is_deleted == False)
        .all()
    )


def remove_from_loan(db: Session, record: LoanPersonnel, deleted_by: uuid.UUID) -> None:
    record.is_deleted = True
    record.deleted_at = datetime.now(timezone.utc)
    record.deleted_by_id = deleted_by
    db.commit()
