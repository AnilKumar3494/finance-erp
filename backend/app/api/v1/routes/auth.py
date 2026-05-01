import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Body
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.dependencies.auth import get_current_user, require_admin, require_super_admin
from app.models.user import User, UserRole
from app.schemas.user import (
    Token,
    UserCreate,
    UserListResponse,
    UserLogin,
    UserResponse,
    AdminUserCreate,
)
from app.services.auth import (
    authenticate_user,
    create_user,
    create_access_token,
    get_user_by_login,
    get_user_by_id,
    list_employees,
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
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """
    Login with either username or email + password.
    Returns a signed JWT access token on success.
    """
    # form_data automatically captures the 'username' and 'password' fields from Swagger
    user = authenticate_user(db, form_data.username, form_data.password)

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


# --------------------------------------------------
# LIST EMPLOYEES
# --------------------------------------------------
@router.get(
    "/employees",
    response_model=UserListResponse,
    status_code=status.HTTP_200_OK,
    summary="List all active employees (Used for Dropdowns)",
)
def get_all_employees(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns a list of all active employees.
    Any authenticated user can access this to populate assignment dropdowns.
    """
    results, total = list_employees(db)
    return UserListResponse(total=total, results=results)


### --------------------------------------------------
### EMPLOYEE MANAGEMENT (Admin & Super Admin)
### --------------------------------------------------
@router.post(
    "/employee",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new Employee account",
)
def create_employee_account(
    payload: AdminUserCreate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    if get_user_by_login(db, payload.username) or get_user_by_login(db, payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or Email already taken",
        )

    # Force role to EMPLOYEE
    payload.role = UserRole.EMPLOYEE
    return create_user(db=db, data=payload, created_by=current_admin.id)


@router.delete(
    "/employee/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove an Employee account",
)
def remove_employee_account(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    user_to_delete = get_user_by_id(db, user_id)
    if not user_to_delete or user_to_delete.role != UserRole.EMPLOYEE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found"
        )

    # Soft delete
    user_to_delete.is_deleted = True
    user_to_delete.is_active = False
    user_to_delete.deleted_by_id = current_admin.id
    user_to_delete.deleted_at = datetime.now(timezone.utc)
    user_to_delete.updated_by_id = current_admin.id
    db.commit()
    return None


### --------------------------------------------------
### ADMIN MANAGEMENT
### --------------------------------------------------
@router.post(
    "/admin",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new Standard Admin account",
)
def create_admin_account(
    payload: AdminUserCreate = Body(
        ...,
        example={
            "username": "admin_priya",
            "email": "priya.admin@financeerp.com",
            "full_name": "Priya Sharma",
            "password": "Must Contain Uppercase and numeric!",
            "role": "ADMIN",
        },
    ),
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    """Both Admins and Super Admins can create Admins"""
    if get_user_by_login(db, payload.username) or get_user_by_login(db, payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or Email already taken",
        )

    # Force role to ADMIN
    payload.role = UserRole.ADMIN
    return create_user(db=db, data=payload, created_by=current_admin.id)


@router.delete(
    "/admin/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a Standard Admin account (SUPER ADMIN ONLY)",
)
def remove_admin_account(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_super_admin),
):
    """Only SUPER_ADMIN can remove a Standard Admin"""
    user_to_delete = get_user_by_id(db, user_id)
    if not user_to_delete or user_to_delete.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Standard Admin not found"
        )

    # Soft delete
    user_to_delete.is_deleted = True
    user_to_delete.is_active = False
    user_to_delete.deleted_by_id = current_admin.id
    user_to_delete.deleted_at = datetime.now(timezone.utc)
    user_to_delete.updated_by_id = current_admin.id
    db.commit()
    return None
