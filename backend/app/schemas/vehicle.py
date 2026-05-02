from decimal import Decimal
from typing import Optional
import uuid

from pydantic import BaseModel, Field, field_validator

from app.models.vehicle import AssetStatus, AssetType


# --------------------------------------------------
# BASE
# --------------------------------------------------
class VehicleBase(BaseModel):
    type: AssetType
    plate_number: str = Field(..., min_length=2, max_length=20)
    make: Optional[str] = Field(None, max_length=50)
    model: Optional[str] = Field(None, max_length=50)

    ##AKCHECK: Check what is the minimun year for a vehicle
    year: Optional[int] = Field(None, ge=1900, le=2100)
    color: Optional[str] = Field(None, max_length=30)
    chassis_number: Optional[str] = Field(None, max_length=50)
    market_value: Decimal = Field(default=Decimal("0.00"), ge=0)
    purchase_cost: Decimal = Field(default=Decimal("0.00"), ge=0)
    status: AssetStatus = AssetStatus.IN_YARD

    @field_validator("plate_number")
    @classmethod
    def uppercase_plate(cls, v: str) -> str:
        return v.upper().strip()


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class VehicleCreate(VehicleBase):
    pass


# --------------------------------------------------
# UPDATE (All optional)
# --------------------------------------------------
class VehicleUpdate(BaseModel):
    type: Optional[AssetType] = None
    plate_number: Optional[str] = Field(None, min_length=2, max_length=20)
    make: Optional[str] = Field(None, max_length=50)
    model: Optional[str] = Field(None, max_length=50)
    year: Optional[int] = Field(None, ge=1900, le=2100)
    color: Optional[str] = Field(None, max_length=30)
    chassis_number: Optional[str] = Field(None, max_length=50)
    market_value: Optional[Decimal] = Field(None, ge=0)
    purchase_cost: Optional[Decimal] = Field(None, ge=0)
    status: Optional[AssetStatus] = None

    @field_validator("plate_number")
    @classmethod
    def uppercase_plate(cls, v: Optional[str]) -> Optional[str]:
        return v.upper().strip() if v else v


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class VehicleResponse(VehicleBase):
    id: uuid.UUID
    is_deleted: bool
    created_by_id: Optional[uuid.UUID]
    updated_by_id: Optional[uuid.UUID]

    model_config = {"from_attributes": True}


# --------------------------------------------------
# LIST RESPONSE (Paginated)
# --------------------------------------------------
class VehicleListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[VehicleResponse]
