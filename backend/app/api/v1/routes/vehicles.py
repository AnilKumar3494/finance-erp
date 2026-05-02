import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin
from app.models.user import User
from app.models.vehicle import AssetStatus, AssetType
from app.schemas.vehicle import (
    VehicleCreate,
    VehicleListResponse,
    VehicleResponse,
    VehicleUpdate,
)
from app.services.vehicle import (
    create_vehicle,
    get_vehicle,
    list_vehicles,
    soft_delete_vehicle,
    update_vehicle,
    get_vehicle_by_plate,
    get_vehicle_by_chassis,
)

router = APIRouter(prefix="/vehicles", tags=["Vehicles"])


# --------------------------------------------------
# CREATE
# --------------------------------------------------
@router.post(
    "/",
    response_model=VehicleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a new vehicle",
)
def create_vehicle_route(
    payload: VehicleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # Admin only
):
    if payload.plate_number and get_vehicle_by_plate(db, payload.plate_number):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Plate number already registered to an active vehicle",
        )

    if payload.chassis_number and get_vehicle_by_chassis(db, payload.chassis_number):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Chassis number already exists in the system",
        )

    return create_vehicle(db=db, data=payload, created_by=current_user.id)


# --------------------------------------------------
# LIST
# --------------------------------------------------
@router.get(
    "/", response_model=VehicleListResponse, summary="List all vehicles with filters"
)
def list_all(
    search: Optional[str] = Query(None, description="Search by plate number"),
    status: Optional[AssetStatus] = Query(None),
    type: Optional[AssetType] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    results, total = list_vehicles(
        db=db, search=search, status=status, type=type, page=page, page_size=page_size
    )
    return VehicleListResponse(
        total=total, page=page, page_size=page_size, results=results
    )


# --------------------------------------------------
# GET BY ID
# --------------------------------------------------
@router.get(
    "/{vehicle_id}",
    response_model=VehicleResponse,
    summary="Get a single vehicle by ID",
)
def get_one(
    vehicle_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vehicle = get_vehicle(db, vehicle_id)
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found"
        )
    return vehicle


# --------------------------------------------------
# UPDATE
# --------------------------------------------------
@router.patch(
    "/{vehicle_id}", response_model=VehicleResponse, summary="Update vehicle details"
)
def update_vehicle_route(
    vehicle_id: uuid.UUID,
    payload: VehicleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # Admin only
):
    vehicle = get_vehicle(db, vehicle_id)
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found"
        )

    if payload.plate_number and payload.plate_number != vehicle.plate_number:
        if get_vehicle_by_plate(db, payload.plate_number):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Plate number already registered to an active vehicle",
            )

    if payload.chassis_number and payload.chassis_number != vehicle.chassis_number:
        if get_vehicle_by_chassis(db, payload.chassis_number):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Chassis number already exists in the system",
            )

    return update_vehicle(
        db=db, vehicle=vehicle, data=payload, updated_by=current_user.id
    )


# --------------------------------------------------
# SOFT DELETE
# --------------------------------------------------
@router.delete(
    "/{vehicle_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft delete a vehicle",
)
def delete_vehicle_route(
    vehicle_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # Admin only
):
    vehicle = get_vehicle(db, vehicle_id)
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found"
        )
    try:
        soft_delete_vehicle(db=db, vehicle=vehicle, deleted_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
