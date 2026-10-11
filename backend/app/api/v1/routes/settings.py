"""
Organisation settings — currently just branding (display name + short name).

GET is public: the login page shows the name before anyone signs in.
PATCH is SUPER_ADMIN only.
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import require_super_admin
from app.models.user import User
from app.schemas.org_settings import BrandingResponse, BrandingUpdate
from app.services.org_settings import get_branding, update_branding

router = APIRouter(prefix="/settings", tags=["Settings"])


@router.get(
    "/branding",
    response_model=BrandingResponse,
    summary="Organisation display name and short name (public)",
)
def read_branding(db: Session = Depends(get_db)):
    return get_branding(db)


@router.patch(
    "/branding",
    response_model=BrandingResponse,
    summary="Update the organisation display name and/or short name",
)
def patch_branding(
    payload: BrandingUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    return update_branding(db, payload, current_user, request)
