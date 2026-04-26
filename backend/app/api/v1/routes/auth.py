from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.user import Token, UserCreate, UserLogin, UserResponse
from app.services.auth import (
    authenticate_user,
    create_user,
    create_access_token,
    get_user_by_login,
)


router = APIRouter(prefix="/auth", tags=["Authentication"])


# --------------------------------------------------
# REGISTER
# --------------------------------------------------
@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new user account",
)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user.
    - Username and email must both be unique
    - Password is hashed before storage — never stored plain
    - First user can be ADMIN, rest default to EMPLOYEE
    """
    # Check username taken
    if get_user_by_login(db, payload.username):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Username already taken"
        )

    # Check email taken
    if get_user_by_login(db, payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        )

    user = create_user(db=db, data=payload)
    return user


# --------------------------------------------------
# LOGIN
# --------------------------------------------------
@router.post(
    "/login",
    response_model=Token,
    status_code=status.HTTP_200_OK,
    summary="Login with username or email",
)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    """
    Login with either username or email + password.
    Returns a signed JWT access token on success.
    """
    user = authenticate_user(db, payload.login, payload.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},  # RFC standard header
        )

    access_token = create_access_token(user_id=user.id, role=user.role.value)

    return Token(access_token=access_token)


# --------------------------------------------------
# ME (Who am I?)
# --------------------------------------------------
@router.get(
    "/me",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Get current logged-in user",
)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user
