import uuid
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.vehicle import AssetStatus, AssetType, Vehicle
from app.schemas.vehicle import VehicleCreate, VehicleUpdate


def get_vehicle(db: Session, vehicle_id: uuid.UUID) -> Optional[Vehicle]:
    """Fetch single active vehicle by ID"""
    return (
        db.query(Vehicle)
        .filter(Vehicle.id == vehicle_id, Vehicle.is_deleted == False)
        .first()
    )


def get_vehicle_by_plate(db: Session, plate_number: str) -> Optional[Vehicle]:
    """Check for duplicate plate number"""
    return (
        db.query(Vehicle)
        .filter(
            Vehicle.plate_number == plate_number.upper(), Vehicle.is_deleted == False
        )
        .first()
    )


def get_vehicle_by_chassis(db: Session, chassis_number: str) -> Optional[Vehicle]:
    """
    Finds a vehicle by chassis number across ALL records.
    A chassis number is permanent and can NEVER be reused, even if deleted.
    """
    return db.query(Vehicle).filter(Vehicle.chassis_number == chassis_number).first()


def list_vehicles(
    db: Session,
    search: Optional[str] = None,
    status: Optional[AssetStatus] = None,
    type: Optional[AssetType] = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Vehicle], int]:
    """
    List vehicles with optional filters.
    Returns (results, total_count)
    """
    query = db.query(Vehicle).filter(Vehicle.is_deleted == False)

    if search:
        query = query.filter(Vehicle.plate_number.ilike(f"%{search.upper()}%"))

    if status:
        query = query.filter(Vehicle.status == status)

    if type:
        query = query.filter(Vehicle.type == type)

    total = query.count()

    results = (
        query.order_by(Vehicle.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return results, total


def create_vehicle(db: Session, data: VehicleCreate, created_by: uuid.UUID) -> Vehicle:
    """Create a new vehicle"""
    vehicle = Vehicle(
        **data.model_dump(),
        created_by_id=created_by,
    )
    db.add(vehicle)
    try:
        db.commit()
        db.refresh(vehicle)
        return vehicle
    except IntegrityError:
        db.rollback()
        raise ValueError("Chassis number already exists")


def update_vehicle(
    db: Session, vehicle: Vehicle, data: VehicleUpdate, updated_by: uuid.UUID
) -> Vehicle:
    """Update only provided fields"""
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(vehicle, field, value)

    vehicle.updated_by_id = updated_by
    try:
        db.commit()
        db.refresh(vehicle)
        return vehicle
    except IntegrityError:
        db.rollback()
        raise ValueError("Plate number or chassis number already exists")


def soft_delete_vehicle(
    db: Session, vehicle: Vehicle, deleted_by: uuid.UUID
) -> Vehicle:
    """Soft delete — never hard delete"""
    from app.models.loan import Loan, LoanStatus
    from datetime import datetime, timezone

    active_loan = (
        db.query(Loan)
        .filter(
            Loan.vehicle_id == vehicle.id,
            Loan.status == LoanStatus.ACTIVE,
            Loan.is_deleted == False,
        )
        .first()
    )
    if active_loan:
        raise ValueError("Cannot delete vehicle — it is collateral for an active loan")

    vehicle.is_deleted = True
    vehicle.deleted_at = datetime.now(timezone.utc)
    vehicle.updated_by_id = deleted_by
    db.commit()
    return vehicle
