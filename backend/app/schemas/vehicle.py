import re
from datetime import datetime
from decimal import Decimal
from typing import Optional
import uuid

from pydantic import BaseModel, Field, field_validator

from app.models.vehicle import AssetStatus, AssetType
from app.utils.time import utcnow


# Vehicle records up to next calendar year are accepted (dealerships often
# register the upcoming model year a few months early).
_MIN_VEHICLE_YEAR = 1900

# Upper sanity cap on monetary fields — vehicles in our portfolio are
# well under ₹100 Cr. Above this is almost certainly a data-entry typo.
_MAX_VEHICLE_VALUE = Decimal("99999999.99")  # ~₹10 Cr

# Permissive Indian plate format. Covers:
#   - Standard: 2 letters + 1-2 digits + 1-3 letters + 4 digits  (e.g. AP09BC1234)
#   - BH-series: YY BH NNNN LL                                   (e.g. 22BH1234AB)
#   - Older formats with fewer letters in the series block.
# After normalization (uppercase, strip, internal spaces stripped).
_PLATE_REGEX = re.compile(
    r"^("
    r"[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}"  # standard
    r"|"
    r"[0-9]{2}BH[0-9]{4}[A-Z]{1,2}"  # BH-series
    r")$"
)


def _max_vehicle_year() -> int:
    return utcnow().year + 1


def is_standard_plate(v: Optional[str]) -> bool:
    """True if `v` matches a recognised Indian plate format after normalization.

    Advisory only — used by clients to flag non-standard plates for review. The
    canonical format check now lives in the frontend (warning, not a hard block).
    """
    if v is None:
        return False
    cleaned = re.sub(r"\s+", "", v).upper()
    return bool(_PLATE_REGEX.match(cleaned))


def _normalize_plate(v: Optional[str]) -> Optional[str]:
    """Uppercase + strip-all-whitespace; reject only empty plates.

    Format is intentionally NOT enforced here. Migrated/legacy records carry
    temporary-registration and other non-standard plates (e.g. "TR-SAF1080");
    rejecting them would make reads (response serialization) and edits 500. The
    Indian-plate-format check is surfaced as a non-blocking warning in the UI.
    """
    if v is None:
        return None
    # Strip every internal whitespace too — humans love writing "AP 09 BC 1234".
    cleaned = re.sub(r"\s+", "", v).upper()
    if len(cleaned) < 2:
        raise ValueError("plate_number must be at least 2 characters")
    return cleaned


def _normalize_name(v: Optional[str]) -> Optional[str]:
    """Trim outer whitespace; collapse internal runs to a single space."""
    if v is None:
        return None
    cleaned = re.sub(r"\s+", " ", v).strip()
    return cleaned or None


def _normalize_alnum_upper(v: Optional[str]) -> Optional[str]:
    """For chassis / engine numbers — strip whitespace and upper-case."""
    if v is None:
        return None
    cleaned = re.sub(r"\s+", "", v).upper()
    return cleaned or None


def _validate_year(v: Optional[int]) -> Optional[int]:
    if v is None:
        return None
    if v < _MIN_VEHICLE_YEAR or v > _max_vehicle_year():
        raise ValueError(
            f"year must be between {_MIN_VEHICLE_YEAR} and {_max_vehicle_year()}"
        )
    return v


def _validate_money(v: Optional[Decimal]) -> Optional[Decimal]:
    if v is None:
        return None
    if v < 0:
        raise ValueError("monetary value cannot be negative")
    if v > _MAX_VEHICLE_VALUE:
        raise ValueError(f"value exceeds sanity cap of {_MAX_VEHICLE_VALUE}")
    return v


# --------------------------------------------------
# BASE
# --------------------------------------------------
class VehicleBase(BaseModel):
    type: AssetType
    plate_number: str = Field(..., min_length=2, max_length=20)
    make: Optional[str] = Field(None, max_length=50)
    model: Optional[str] = Field(None, max_length=50)
    year: Optional[int] = None
    color: Optional[str] = Field(None, max_length=30)
    chassis_number: Optional[str] = Field(None, max_length=50)
    engine_number: Optional[str] = Field(None, max_length=50)
    market_value: Decimal = Field(default=Decimal("0.00"))
    purchase_cost: Decimal = Field(default=Decimal("0.00"))
    status: AssetStatus = AssetStatus.IN_YARD

    @field_validator("plate_number")
    @classmethod
    def uppercase_plate(cls, v: str) -> str:
        normalized = _normalize_plate(v)
        # _normalize_plate only returns None when input is None; on a required
        # field that can't happen, but assert to satisfy the type checker.
        assert normalized is not None
        return normalized

    @field_validator("make", "model", "color")
    @classmethod
    def trim_name(cls, v: Optional[str]) -> Optional[str]:
        return _normalize_name(v)

    @field_validator("chassis_number", "engine_number")
    @classmethod
    def trim_alnum(cls, v: Optional[str]) -> Optional[str]:
        return _normalize_alnum_upper(v)

    @field_validator("year")
    @classmethod
    def check_year(cls, v: Optional[int]) -> Optional[int]:
        return _validate_year(v)

    @field_validator("market_value", "purchase_cost")
    @classmethod
    def check_money(cls, v: Decimal) -> Decimal:
        validated = _validate_money(v)
        # Required (non-None) fields — assert for the type checker.
        assert validated is not None
        return validated


# --------------------------------------------------
# CREATE
# --------------------------------------------------
class VehicleCreate(VehicleBase):
    pass


# --------------------------------------------------
# UPDATE (mutable fields only — chassis_number and type are IMMUTABLE
# post-creation. Chassis is the permanent VIN; flipping `type` while a
# vehicle backs an active loan would corrupt the asset register.)
# --------------------------------------------------
class VehicleUpdate(BaseModel):
    plate_number: Optional[str] = Field(None, min_length=2, max_length=20)
    make: Optional[str] = Field(None, max_length=50)
    model: Optional[str] = Field(None, max_length=50)
    year: Optional[int] = None
    color: Optional[str] = Field(None, max_length=30)
    engine_number: Optional[str] = Field(None, max_length=50)
    market_value: Optional[Decimal] = None
    purchase_cost: Optional[Decimal] = None
    status: Optional[AssetStatus] = None

    model_config = {"extra": "forbid"}

    @field_validator("plate_number")
    @classmethod
    def uppercase_plate(cls, v: Optional[str]) -> Optional[str]:
        return _normalize_plate(v)

    @field_validator("make", "model", "color")
    @classmethod
    def trim_name(cls, v: Optional[str]) -> Optional[str]:
        return _normalize_name(v)

    @field_validator("engine_number")
    @classmethod
    def trim_alnum(cls, v: Optional[str]) -> Optional[str]:
        return _normalize_alnum_upper(v)

    @field_validator("year")
    @classmethod
    def check_year(cls, v: Optional[int]) -> Optional[int]:
        return _validate_year(v)

    @field_validator("market_value", "purchase_cost")
    @classmethod
    def check_money(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        return _validate_money(v)


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class VehicleResponse(VehicleBase):
    id: uuid.UUID
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None
    created_by_id: Optional[uuid.UUID] = None
    updated_by_id: Optional[uuid.UUID] = None
    deleted_by_id: Optional[uuid.UUID] = None

    model_config = {"from_attributes": True}


# --------------------------------------------------
# LIST RESPONSE (Paginated)
# --------------------------------------------------
class VehicleListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[VehicleResponse]
