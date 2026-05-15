"""
Auth dependencies.

`get_current_user` is the single gate every protected route flows through.
JWT decode delegates to `services.auth.decode_access_token` so verification
logic lives in exactly one place.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.user import User, UserRole
from app.services.auth import decode_access_token, get_user_by_id

# --------------------------------------------------
# TOKEN EXTRACTOR — pulls Bearer token from Authorization header.
# --------------------------------------------------
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


# --------------------------------------------------
# CORE DEPENDENCY
# --------------------------------------------------
def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    """Decode the JWT, then fetch the matching active user from DB."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_data = decode_access_token(token)
    if token_data is None or token_data.user_id is None:
        raise credentials_exc

    user = get_user_by_id(db, token_data.user_id)
    if user is None:
        # User was deactivated/deleted after the token was issued.
        raise credentials_exc

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """
    Allows ADMIN and SUPER_ADMIN.
    Used for: creating Employees, creating Admins, listing Employees,
    soft-deleting Employees, unmasking customer PII.
    """
    if current_user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough privileges. Admin access required.",
        )
    return current_user


def require_super_admin(current_user: User = Depends(get_current_user)) -> User:
    """
    Allows ONLY SUPER_ADMIN.
    Used for: removing Admins, removing Employees (per policy: only the
    super admin can remove users from the system).
    """
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Supreme privileges required. Super Admin access only.",
        )
    return current_user
