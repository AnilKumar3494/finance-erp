import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin
from app.models.user import User, UserRole
from app.models.vehicle import AssetStatus, AssetType
from app.models.loan import LoanStatus
from app.models.document import DocCategory
from app.schemas.vehicle import (
    VehicleCreate,
    VehicleListResponse,
    VehicleResponse,
    VehicleUpdate,
)
from app.schemas.loan import LoanListResponse
from app.schemas.document import DocumentListResponse, DocumentResponse
from app.services.vehicle import (
    create_vehicle,
    get_vehicle,
    get_vehicle_including_deleted,
    list_vehicles,
    restore_vehicle,
    soft_delete_vehicle,
    update_vehicle,
    get_vehicle_by_plate,
    get_vehicle_by_chassis,
)
from app.services.loan import list_loans, parse_includes
from app.services.document import list_documents
# Reuse the loans-route enrichment so computed finance fields (monthly_interest,
# total_payable, net_*) are populated consistently across both endpoints.
from app.api.v1.routes.loans import enrich_loan

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

    try:
        return create_vehicle(db=db, data=payload, created_by=current_user.id)
    except ValueError as e:
        # Race-condition fallback: pre-checks above passed but the DB unique
        # constraint still fired. Surface the precise message from the service.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


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

    # Chassis number and `type` are no longer mutable via VehicleUpdate
    # (P1-6) — see app/schemas/vehicle.py. Only plate uniqueness needs a
    # pre-check; the DB constraint backs us up via the service translator.
    if payload.plate_number and payload.plate_number != vehicle.plate_number:
        if get_vehicle_by_plate(db, payload.plate_number):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Plate number already registered to an active vehicle",
            )

    try:
        return update_vehicle(
            db=db, vehicle=vehicle, data=payload, updated_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


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


# --------------------------------------------------
# RESTORE (un-soft-delete)
# --------------------------------------------------
@router.post(
    "/{vehicle_id}/restore",
    response_model=VehicleResponse,
    summary="Restore a soft-deleted vehicle",
)
def restore_vehicle_route(
    vehicle_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),  # Admin only
):
    # Must use the include-deleted fetcher — by definition the row is hidden
    # from the standard get_vehicle() filter.
    vehicle = get_vehicle_including_deleted(db, vehicle_id)
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found"
        )
    try:
        return restore_vehicle(
            db=db, vehicle=vehicle, restored_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


# --------------------------------------------------
# SUB-RESOURCE: loans backed by this vehicle
# --------------------------------------------------
@router.get(
    "/{vehicle_id}/loans",
    response_model=LoanListResponse,
    summary="List loans backed by this vehicle",
)
def list_vehicle_loans(
    vehicle_id: uuid.UUID,
    status_filter: Optional[LoanStatus] = Query(None, alias="status"),
    include: Optional[str] = Query(
        None,
        description="Comma-separated list of related objects to include: customer, vehicle, created_by, updated_by",
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vehicle = get_vehicle(db, vehicle_id)
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found"
        )
    # RBAC scoping mirrors loans.list_all: employees see only loans whose
    # customer is assigned to them. Admin / super-admin see everything.
    assigned_employee_id = (
        current_user.id if current_user.role == UserRole.EMPLOYEE else None
    )
    includes = parse_includes(include)
    results, total = list_loans(
        db=db,
        vehicle_id=vehicle_id,
        status=status_filter,
        page=page,
        page_size=page_size,
        assigned_employee_id=assigned_employee_id,
        include=include,
    )
    return LoanListResponse(
        total=total,
        page=page,
        page_size=page_size,
        results=[enrich_loan(loan, includes) for loan in results],
    )


# --------------------------------------------------
# SUB-RESOURCE: documents linked to this vehicle
# --------------------------------------------------
@router.get(
    "/{vehicle_id}/documents",
    response_model=DocumentListResponse,
    summary="List documents linked to this vehicle (RC, insurance, photos)",
)
def list_vehicle_documents(
    vehicle_id: uuid.UUID,
    doc_type: Optional[DocCategory] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vehicle = get_vehicle(db, vehicle_id)
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found"
        )
    results, total = list_documents(
        db=db,
        requesting_user=current_user,
        vehicle_id=vehicle_id,
        doc_type=doc_type,
        page=page,
        page_size=page_size,
    )
    return DocumentListResponse(
        total=total,
        page=page,
        page_size=page_size,
        results=[DocumentResponse.model_validate(d) for d in results],
    )
