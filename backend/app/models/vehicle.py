import enum
from typing import TYPE_CHECKING, Optional

from decimal import Decimal
from sqlalchemy import Enum, Numeric, String, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditBase

if TYPE_CHECKING:
    from app.models.loan import Loan


class AssetType(str, enum.Enum):
    INVENTORY = "INVENTORY"
    COLLATERAL = "COLLATERAL"


class AssetStatus(str, enum.Enum):
    IN_YARD = "IN_YARD"
    SEIZED = "SEIZED"
    MAINTENANCE = "MAINTENANCE"
    SOLD = "SOLD"


class Vehicle(AuditBase):
    __tablename__ = "vehicles"

    # --------------------------------------------------
    # VEHICLE INFO
    # --------------------------------------------------
    type: Mapped[AssetType] = mapped_column(
        Enum(AssetType, name="asset_type", create_type=False), nullable=False
    )

    plate_number: Mapped[str] = mapped_column(
        String(20), unique=True, nullable=False, index=True
    )

    make: Mapped[Optional[str]] = mapped_column(String(50))
    model: Mapped[Optional[str]] = mapped_column(String(50))
    year: Mapped[Optional[int]] = mapped_column(Integer)
    color: Mapped[Optional[str]] = mapped_column(String(30))

    ##AKCHECK: Check if this is must required or if this can be optional
    chassis_number: Mapped[Optional[str]] = mapped_column(String(50), unique=True)

    market_value: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), default=Decimal("0.00"), server_default="0.00", nullable=False
    )

    purchase_cost: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), default=Decimal("0.00"), server_default="0.00", nullable=False
    )
    status: Mapped[AssetStatus] = mapped_column(
        Enum(AssetStatus, name="asset_status", create_type=False),
        default=AssetStatus.IN_YARD,
        server_default="IN_YARD",
        nullable=False,
    )

    # --------------------------------------------------
    # RELATIONSHIPS
    # --------------------------------------------------
    loans: Mapped[list["Loan"]] = relationship(
        "Loan",
        back_populates="vehicle",
        primaryjoin="and_(Vehicle.id == Loan.vehicle_id, Loan.is_deleted == False)",
    )
