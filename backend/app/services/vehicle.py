import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Optional

from fastapi import Request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Query, Session

from app.models.vehicle import AssetStatus, AssetType, Vehicle
from app.schemas.vehicle import VehicleCreate, VehicleUpdate
from app.utils.audit import write_audit


# Whitelist of columns the list endpoint can sort by. Mirrors the frontend
# VEHICLE_SORT_FIELDS in api/queries/vehicles.ts. Unknown values fall back to
# created_at desc so the response stays deterministic.
_SORTABLE_COLUMNS: dict[str, Any] = {
    "plate_number": Vehicle.plate_number,
    "make": Vehicle.make,
    "year": Vehicle.year,
    "status": Vehicle.status,
    "market_value": Vehicle.market_value,
    "created_at": Vehicle.created_at,
}


def _vehicle_audit_snapshot(v: Vehicle) -> dict:
    return {
        "plate_number": v.plate_number,
        "chassis_number": v.chassis_number,
        "type": v.type.value if v.type else None,
        "status": v.status.value if v.status else None,
    }


# Constraint-name → user-facing message. Keeps the create/update error
# handling honest instead of always blaming the chassis column.
#
# Migration 007 renames the plate uniqueness constraint:
#   vehicles_plate_number_key (global)
#     → uq_vehicles_plate_number_active (partial, WHERE is_deleted=false).
# Both names are listed so the mapping stays correct on environments where
# migration 007 has not been applied yet. Safe to drop the legacy key once
# all envs are migrated.
_VEHICLE_CONSTRAINT_MESSAGES = {
    "uq_vehicles_plate_number_active": "Plate number already registered to an active vehicle",
    "vehicles_plate_number_key": "Plate number already registered to an active vehicle",
    "vehicles_chassis_number_key": "Chassis number already exists in the system",
}


# --------------------------------------------------
# STATUS STATE MACHINE
# --------------------------------------------------
# Allowed transitions for AssetStatus. SOLD is terminal — once an asset is
# sold the book entry is closed and any further movement requires a new
# vehicle row + audit trail. Re-listing a sold vehicle by flipping the
# status would corrupt the asset register.
_ALLOWED_STATUS_TRANSITIONS: dict[AssetStatus, frozenset[AssetStatus]] = {
    AssetStatus.IN_YARD: frozenset(
        {AssetStatus.IN_YARD, AssetStatus.MAINTENANCE, AssetStatus.SEIZED, AssetStatus.SOLD}
    ),
    AssetStatus.MAINTENANCE: frozenset(
        {AssetStatus.IN_YARD, AssetStatus.MAINTENANCE, AssetStatus.SEIZED, AssetStatus.SOLD}
    ),
    AssetStatus.SEIZED: frozenset(
        {AssetStatus.IN_YARD, AssetStatus.MAINTENANCE, AssetStatus.SEIZED, AssetStatus.SOLD}
    ),
    AssetStatus.SOLD: frozenset({AssetStatus.SOLD}),
}


def _validate_status_transition(
    current: AssetStatus, requested: AssetStatus
) -> None:
    if requested not in _ALLOWED_STATUS_TRANSITIONS[current]:
        raise ValueError(
            f"Invalid status transition: {current.value} -> {requested.value}"
        )


def _translate_integrity_error(exc: IntegrityError) -> ValueError:
    """Map a Postgres unique-violation to a precise ValueError."""
    constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
    if constraint and constraint in _VEHICLE_CONSTRAINT_MESSAGES:
        return ValueError(_VEHICLE_CONSTRAINT_MESSAGES[constraint])
    # Fallback: surface as a generic conflict rather than a misleading message.
    return ValueError("Vehicle uniqueness constraint violated")


def get_vehicle(db: Session, vehicle_id: uuid.UUID) -> Optional[Vehicle]:
    """Fetch single active vehicle by ID"""
    return (
        db.query(Vehicle)
        .filter(Vehicle.id == vehicle_id, Vehicle.is_deleted == False)
        .first()
    )


def get_vehicle_including_deleted(
    db: Session, vehicle_id: uuid.UUID
) -> Optional[Vehicle]:
    """Fetch a vehicle row whether or not it has been soft-deleted."""
    return db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()


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


def _vehicle_filtered_query(
    db: Session,
    *,
    search: Optional[str] = None,
    status: Optional[AssetStatus] = None,
    type: Optional[AssetType] = None,
    created_after: Optional[date] = None,
    created_before: Optional[date] = None,
) -> Query:
    """
    The filtered (unsorted, unpaginated) vehicle query shared by the paginated
    list and the KPI aggregate (`vehicle_stats`), so both agree on which rows
    the filters select. `created_after`/`created_before` bound the registration
    (created_at) date inclusively; created_at is a timestamp, so the upper bound
    covers the whole of that day.
    """
    query = db.query(Vehicle).filter(Vehicle.is_deleted == False)

    if search:
        query = query.filter(Vehicle.plate_number.ilike(f"%{search.upper()}%"))

    if status:
        query = query.filter(Vehicle.status == status)

    if type:
        query = query.filter(Vehicle.type == type)

    if created_after is not None:
        query = query.filter(Vehicle.created_at >= datetime.combine(created_after, time.min))

    if created_before is not None:
        query = query.filter(
            Vehicle.created_at < datetime.combine(created_before + timedelta(days=1), time.min)
        )

    return query


def vehicle_stats(
    db: Session,
    *,
    search: Optional[str] = None,
    status: Optional[AssetStatus] = None,
    type: Optional[AssetType] = None,
    created_after: Optional[date] = None,
    created_before: Optional[date] = None,
) -> dict:
    """
    Portfolio KPIs over the whole filtered set (not just the visible page) for
    the Vehicles list summary cards: how many vehicles the filters select,
    broken down by status, and the total market value / purchase cost.
    """
    query = _vehicle_filtered_query(
        db,
        search=search,
        status=status,
        type=type,
        created_after=created_after,
        created_before=created_before,
    )
    total, market, cost = query.with_entities(
        func.count(Vehicle.id),
        func.coalesce(func.sum(Vehicle.market_value), 0),
        func.coalesce(func.sum(Vehicle.purchase_cost), 0),
    ).one()

    status_rows = (
        query.with_entities(Vehicle.status, func.count(Vehicle.id))
        .group_by(Vehicle.status)
        .all()
    )
    # Every status present, zero-filled, so the frontend can read any key.
    status_counts = {s.value: 0 for s in AssetStatus}
    for s, n in status_rows:
        status_counts[s.value] = int(n)

    return {
        "total_vehicles": int(total),
        "total_market_value": Decimal(market),
        "total_purchase_cost": Decimal(cost),
        "status_counts": status_counts,
    }


def list_vehicles(
    db: Session,
    search: Optional[str] = None,
    status: Optional[AssetStatus] = None,
    type: Optional[AssetType] = None,
    page: int = 1,
    page_size: int = 20,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = None,
    created_after: Optional[date] = None,
    created_before: Optional[date] = None,
) -> tuple[list[Vehicle], int]:
    """
    List vehicles with optional filters.
    Returns (results, total_count)
    """
    query = _vehicle_filtered_query(
        db,
        search=search,
        status=status,
        type=type,
        created_after=created_after,
        created_before=created_before,
    )

    total = query.count()

    # Sort. Unknown sort_by falls back to created_at desc. The id tie-breaker
    # keeps pagination stable when many rows share the same sort key.
    column = _SORTABLE_COLUMNS.get(sort_by or "", Vehicle.created_at)
    descending = (sort_order or "desc").lower() != "asc"
    ordering = column.desc() if descending else column.asc()

    results = (
        query.order_by(ordering, Vehicle.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return results, total


def create_vehicle(
    db: Session,
    data: VehicleCreate,
    created_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> Vehicle:
    """Create a new vehicle"""
    vehicle = Vehicle(
        **data.model_dump(),
        created_by_id=created_by,
    )
    db.add(vehicle)
    try:
        db.flush()
        write_audit(
            db,
            action_type="VEHICLE_CREATE",
            target_table="vehicles",
            record_id=vehicle.id,
            user_id=created_by,
            new_data=_vehicle_audit_snapshot(vehicle),
            request=request,
        )
        db.commit()
        db.refresh(vehicle)
        return vehicle
    except IntegrityError as e:
        db.rollback()
        raise _translate_integrity_error(e) from e


def update_vehicle(
    db: Session,
    vehicle: Vehicle,
    data: VehicleUpdate,
    updated_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> Vehicle:
    """Update only provided fields"""
    changes = data.model_dump(exclude_unset=True)

    # State machine + cross-domain safety: can't SOLD/SEIZED a vehicle that
    # is still collateral on a live loan.
    if "status" in changes and changes["status"] is not None:
        new_status = changes["status"]
        _validate_status_transition(vehicle.status, new_status)
        if new_status in (AssetStatus.SOLD, AssetStatus.SEIZED):
            from app.services.loan import is_blocking_vehicle

            if is_blocking_vehicle(db, vehicle.id):
                raise ValueError(
                    f"Cannot mark {new_status.value} — vehicle backs an active loan"
                )

    before = _vehicle_audit_snapshot(vehicle)
    for field, value in changes.items():
        setattr(vehicle, field, value)

    vehicle.updated_by_id = updated_by
    try:
        db.flush()
        write_audit(
            db,
            action_type="VEHICLE_UPDATE",
            target_table="vehicles",
            record_id=vehicle.id,
            user_id=updated_by,
            old_data=before,
            new_data=_vehicle_audit_snapshot(vehicle),
            request=request,
        )
        db.commit()
        db.refresh(vehicle)
        return vehicle
    except IntegrityError as e:
        db.rollback()
        raise _translate_integrity_error(e) from e


def soft_delete_vehicle(
    db: Session,
    vehicle: Vehicle,
    deleted_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> Vehicle:
    """Soft delete — never hard delete"""
    # Local import keeps the import graph acyclic at module load time
    # (loan.py imports Vehicle; vehicle.py only needs the loan service helper).
    from app.services.loan import is_blocking_vehicle

    if is_blocking_vehicle(db, vehicle.id):
        raise ValueError("Cannot delete vehicle — it is collateral for an active loan")

    snapshot = _vehicle_audit_snapshot(vehicle)
    vehicle.soft_delete(by_id=deleted_by)
    db.flush()
    write_audit(
        db,
        action_type="VEHICLE_DELETE",
        target_table="vehicles",
        record_id=vehicle.id,
        user_id=deleted_by,
        old_data=snapshot,
        request=request,
    )
    db.commit()
    # Hydrate DB-side values (deleted_at, updated_at trigger) before returning.
    db.refresh(vehicle)
    return vehicle


def restore_vehicle(
    db: Session,
    vehicle: Vehicle,
    restored_by: uuid.UUID,
    *,
    request: Optional[Request] = None,
) -> Vehicle:
    """
    Reverse a soft-delete. Blocked if the plate is already in use by another
    active vehicle (would violate uq_vehicles_plate_number_active).
    """
    if not vehicle.is_deleted:
        raise ValueError("Vehicle is not deleted")

    conflict = (
        db.query(Vehicle)
        .filter(
            Vehicle.plate_number == vehicle.plate_number,
            Vehicle.is_deleted == False,
            Vehicle.id != vehicle.id,
        )
        .first()
    )
    if conflict:
        raise ValueError(
            "Cannot restore — another active vehicle already holds this plate"
        )

    vehicle.restore(by_id=restored_by)
    db.flush()
    write_audit(
        db,
        action_type="VEHICLE_RESTORE",
        target_table="vehicles",
        record_id=vehicle.id,
        user_id=restored_by,
        new_data=_vehicle_audit_snapshot(vehicle),
        request=request,
    )
    db.commit()
    db.refresh(vehicle)
    return vehicle
