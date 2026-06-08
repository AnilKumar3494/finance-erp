import uuid
from typing import Optional

from fastapi import Request
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.customer import Customer
from app.models.loan import Loan
from app.models.personnel import LoanPersonnel, Personnel
from app.schemas.personnel import (
    LoanAssociationSummary,
    LoanPersonnelCreate,
    LoanPersonnelUpdate,
    PersonnelCreate,
    PersonnelUpdate,
)
from app.utils.audit import write_audit
from app.utils.db_errors import safe_integrity_message

_MUTABLE_FIELDS = frozenset(
    {
        "full_name",
        "mobile_number",
        "date_of_birth",
        "alt_mobile_number",
        "aadhaar_number",
        "pan_number",
        "address_line_1",
        "address_line_2",
        "mandal_village",
        "pincode",
        "remarks",
    }
)


_AUDIT_SAFE_FIELDS = (
    "full_name",
    "mobile_number",
    "alt_mobile_number",
    "address_line_1",
    "address_line_2",
    "mandal_village",
    "pincode",
)


def _audit_snapshot(person: Personnel) -> dict:
    return {f: getattr(person, f, None) for f in _AUDIT_SAFE_FIELDS}


def _same_identity(person: Personnel, customer: Customer) -> bool:
    """
    True if the personnel record is, by identity, the loan's own customer.
    Used to block a customer from guaranteeing/co-hiring their own loan.
    """
    if person.mobile_number and person.mobile_number == customer.mobile_number:
        return True
    if (
        person.aadhaar_number
        and customer.aadhaar_number
        and person.aadhaar_number == customer.aadhaar_number
    ):
        return True
    if (
        person.pan_number
        and customer.pan_number
        and person.pan_number == customer.pan_number
    ):
        return True
    return False


# --------------------------------------------------
# READS
# --------------------------------------------------
def get_personnel(db: Session, personnel_id: uuid.UUID) -> Optional[Personnel]:
    return (
        db.query(Personnel)
        .filter(Personnel.id == personnel_id, Personnel.is_deleted == False)
        .first()
    )


def get_loan_personnel_record(
    db: Session, loan_personnel_id: uuid.UUID
) -> Optional[LoanPersonnel]:
    return (
        db.query(LoanPersonnel)
        .filter(
            LoanPersonnel.id == loan_personnel_id,
            LoanPersonnel.is_deleted == False,
        )
        .first()
    )


def _has_active_loan_link(db: Session, personnel_id: uuid.UUID) -> bool:
    """True if the person is linked to any non-deleted loan."""
    return (
        db.query(LoanPersonnel.id)
        .join(Loan, LoanPersonnel.loan_id == Loan.id)
        .filter(
            LoanPersonnel.personnel_id == personnel_id,
            LoanPersonnel.is_deleted == False,
            Loan.is_deleted == False,
        )
        .first()
        is not None
    )


# --------------------------------------------------
# CREATE
# --------------------------------------------------
def create_personnel(
    db: Session,
    data: PersonnelCreate,
    created_by: uuid.UUID,
    request: Optional[Request] = None,
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
        pincode=data.pincode,
        remarks=data.remarks,
        created_by_id=created_by,
    )
    db.add(person)
    try:
        db.flush()
        write_audit(
            db,
            action_type="PERSONNEL_CREATE",
            target_table="personnel",
            record_id=person.id,
            user_id=created_by,
            new_data=_audit_snapshot(person),
            request=request,
        )
        db.commit()
        db.refresh(person)
        return person
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e))


# --------------------------------------------------
# UPDATE
# --------------------------------------------------
def update_personnel(
    db: Session,
    person: Personnel,
    data: PersonnelUpdate,
    updated_by: uuid.UUID,
    request: Optional[Request] = None,
) -> Personnel:
    changes = data.model_dump(exclude_unset=True)

    illegal = set(changes) - _MUTABLE_FIELDS
    if illegal:
        raise ValueError(f"Fields not allowed: {sorted(illegal)}")

    before = _audit_snapshot(person)

    for field, value in changes.items():
        setattr(person, field, value)

    person.updated_by_id = updated_by

    try:
        write_audit(
            db,
            action_type="PERSONNEL_UPDATE",
            target_table="personnel",
            record_id=person.id,
            user_id=updated_by,
            old_data=before,
            new_data=_audit_snapshot(person),
            request=request,
        )
        db.commit()
        db.refresh(person)
        return person
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e))


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
def soft_delete_personnel(
    db: Session,
    person: Personnel,
    deleted_by: uuid.UUID,
    request: Optional[Request] = None,
) -> Personnel:
    """Block soft-delete while the person is linked to any non-deleted loan."""
    if _has_active_loan_link(db, person.id):
        raise ValueError(
            "Cannot delete a person who is still linked to a loan. "
            "Remove them from the loan(s) first."
        )

    before = _audit_snapshot(person)
    person.soft_delete(deleted_by)

    write_audit(
        db,
        action_type="PERSONNEL_DELETE",
        target_table="personnel",
        record_id=person.id,
        user_id=deleted_by,
        old_data=before,
        request=request,
    )
    db.commit()
    return person


# --------------------------------------------------
# LOOKUP
# --------------------------------------------------
def lookup_personnel(
    db: Session,
    mobile_number: Optional[str] = None,
    aadhaar_number: Optional[str] = None,
    pan_number: Optional[str] = None,
) -> tuple[Optional[Personnel], list[LoanAssociationSummary]]:
    # Normalize PAN to match the upper-cased form stored on write.
    if pan_number:
        pan_number = pan_number.upper()

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
        .order_by(Personnel.created_at)
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
        .order_by(Loan.loan_number)
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


# --------------------------------------------------
# LOAN ↔ PERSONNEL LINKS
# --------------------------------------------------
def add_to_loan(
    db: Session,
    loan_id: uuid.UUID,
    data: LoanPersonnelCreate,
    created_by: uuid.UUID,
    request: Optional[Request] = None,
) -> LoanPersonnel:
    person = get_personnel(db, data.personnel_id)
    if person is None:
        raise ValueError("Personnel not found")

    customer = (
        db.query(Customer)
        .join(Loan, Loan.customer_id == Customer.id)
        .filter(Loan.id == loan_id)
        .first()
    )
    if customer is not None and _same_identity(person, customer):
        raise ValueError(
            "A customer cannot be their own guarantor or co-hirer on their own loan."
        )

    record = LoanPersonnel(
        loan_id=loan_id,
        personnel_id=data.personnel_id,
        role=data.role,
        relationship_to_hirer=data.relationship_to_hirer,
        created_by_id=created_by,
    )
    db.add(record)
    try:
        db.flush()
        write_audit(
            db,
            action_type="LOAN_PERSONNEL_ADD",
            target_table="loan_personnel",
            record_id=record.id,
            user_id=created_by,
            new_data={
                "loan_id": loan_id,
                "personnel_id": data.personnel_id,
                "role": data.role.value,
                "relationship_to_hirer": data.relationship_to_hirer,
            },
            request=request,
        )
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise ValueError(safe_integrity_message(e))

    return (
        db.query(LoanPersonnel)
        .options(joinedload(LoanPersonnel.personnel))
        .filter(LoanPersonnel.id == record.id)
        .first()
    )


def list_loan_personnel(db: Session, loan_id: uuid.UUID) -> list[LoanPersonnel]:
    return (
        db.query(LoanPersonnel)
        .options(joinedload(LoanPersonnel.personnel))
        .filter(
            LoanPersonnel.loan_id == loan_id,
            LoanPersonnel.is_deleted == False,
        )
        .all()
    )


def update_loan_personnel(
    db: Session,
    record: LoanPersonnel,
    data: LoanPersonnelUpdate,
    updated_by: uuid.UUID,
    request: Optional[Request] = None,
) -> LoanPersonnel:
    fields = data.model_dump(exclude_unset=True)
    old = {"relationship_to_hirer": record.relationship_to_hirer}
    if "relationship_to_hirer" in fields:
        record.relationship_to_hirer = fields["relationship_to_hirer"]
    record.updated_by_id = updated_by

    write_audit(
        db,
        action_type="LOAN_PERSONNEL_UPDATE",
        target_table="loan_personnel",
        record_id=record.id,
        user_id=updated_by,
        old_data=old,
        new_data={"relationship_to_hirer": record.relationship_to_hirer},
        request=request,
    )
    db.commit()

    return (
        db.query(LoanPersonnel)
        .options(joinedload(LoanPersonnel.personnel))
        .filter(LoanPersonnel.id == record.id)
        .first()
    )


def remove_from_loan(
    db: Session,
    record: LoanPersonnel,
    deleted_by: uuid.UUID,
    request: Optional[Request] = None,
) -> None:
    record.soft_delete(deleted_by)
    write_audit(
        db,
        action_type="LOAN_PERSONNEL_REMOVE",
        target_table="loan_personnel",
        record_id=record.id,
        user_id=deleted_by,
        old_data={
            "loan_id": record.loan_id,
            "personnel_id": record.personnel_id,
            "role": record.role.value,
        },
        request=request,
    )
    db.commit()
