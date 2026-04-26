import uuid
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.user import User, UserRole
from app.services.auth import decode_access_token, get_user_by_id

# --------------------------------------------------
# TOKEN EXTRACTOR
# Pulls Bearer token from Authorization header
# --------------------------------------------------
bearer_scheme = HTTPBearer(auto_error=False)


# --------------------------------------------------
# CORE DEPENDENCY — get_current_user
# Every protected route uses this
# --------------------------------------------------
def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    1. Extracts JWT from Authorization: Bearer <token>
    2. Decodes and validates the token
    3. Fetches the user from DB
    4. Returns the live User ORM object
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # No token provided
    if not credentials:
        raise credentials_exception

    # Decode the JWT
    token_data = decode_access_token(credentials.credentials)
    if not token_data or not token_data.user_id:
        raise credentials_exception

    # Fetch user from DB — confirms they still exist and are active
    user = get_user_by_id(db, token_data.user_id)
    if not user:
        raise credentials_exception

    return user


# --------------------------------------------------
# ROLE GUARDS
# Use these on routes that need specific permissions
# --------------------------------------------------
def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Only ADMIN role can access this route"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
        )
    return current_user


def require_active_user(current_user: User = Depends(get_current_user)) -> User:
    """Blocks suspended accounts even with valid JWT"""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled"
        )
    return current_user
