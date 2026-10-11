"""
Organisation branding (display name + short name) for this deployment.

The single org_settings row wins when present; otherwise the env defaults
ORG_DISPLAY_NAME / ORG_SHORT_NAME apply.
"""
from typing import Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.org_settings import OrgSettings
from app.models.user import User
from app.schemas.org_settings import BrandingResponse, BrandingUpdate
from app.utils.audit import write_audit
from app.utils.time import utcnow


def get_branding(db: Session) -> BrandingResponse:
    row = db.get(OrgSettings, 1)
    if row is None:
        return BrandingResponse(
            display_name=settings.ORG_DISPLAY_NAME,
            short_name=settings.ORG_SHORT_NAME,
        )
    return BrandingResponse(display_name=row.display_name, short_name=row.short_name)


def update_branding(
    db: Session,
    data: BrandingUpdate,
    user: User,
    request: Optional[Request] = None,
) -> BrandingResponse:
    """Upsert the single row. Omitted fields keep their current (or default) value."""
    old = get_branding(db)
    new = BrandingResponse(
        display_name=data.display_name if data.display_name is not None else old.display_name,
        short_name=data.short_name if data.short_name is not None else old.short_name,
    )

    row = db.get(OrgSettings, 1)
    if row is None:
        row = OrgSettings(id=1)
        db.add(row)
    row.display_name = new.display_name
    row.short_name = new.short_name
    row.updated_at = utcnow()
    row.updated_by = user.id
    db.flush()

    write_audit(
        db,
        action_type="ORG_SETTINGS_UPDATE",
        target_table="org_settings",
        user_id=user.id,
        old_data=old.model_dump(),
        new_data=new.model_dump(),
        request=request,
    )
    db.commit()
    return new
