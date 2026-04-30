import uuid
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.models.user import User, UserRole
from app.services.auth import decode_access_token, get_user_by_id

# --------------------------------------------------
# TOKEN EXTRACTOR
# Pulls Bearer token from Authorization header
# --------------------------------------------------
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


# --------------------------------------------------
# CORE DEPENDENCY — get_current_user
# Every protected route uses this
# --------------------------------------------------
def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    """Decodes the JWT and fetches the active user."""
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
            )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    user = get_user_by_id(db, uuid.UUID(user_id_str))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found or inactive"
        )
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """
    Guard 1: Standard Admin Level
    Allows BOTH Standard ADMIN and SUPER_ADMIN.
    Used for: Creating/Removing Employees, Creating Admins.
    """
    if current_user.role not in [UserRole.ADMIN, UserRole.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough privileges. Admin access required.",
        )
    return current_user


def require_super_admin(current_user: User = Depends(get_current_user)) -> User:
    """
    Guard 2: Super Admin Level
    Allows ONLY SUPER_ADMIN.
    Used for: Removing Standard Admins.
    """
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Supreme privileges required. Super Admin access only.",
        )
    return current_user
