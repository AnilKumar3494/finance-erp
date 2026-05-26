"""
Authentication & user-management routes.

Authorization matrix:
  POST   /register            Public, but only when zero users exist OR all
                              public registrations create an EMPLOYEE.
  POST   /login               Public. Rate-limited.
  GET    /me                  Any authenticated user.
  GET    /employees           Admin + Super Admin. Paginated.
  POST   /employee            Admin + Super Admin. Creates EMPLOYEE.
  DELETE /employee/{id}       Admin + Super Admin. Self-delete blocked.
  POST   /admin               Admin + Super Admin. Creates ADMIN.
  DELETE /admin/{id}          SUPER_ADMIN only. Self-delete blocked (and
                              structurally impossible since target must be ADMIN).
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.rate_limit import limiter
from app.dependencies.auth import get_current_user, require_admin, require_super_admin
from app.models.user import User, UserRole
from app.schemas.user import (
    AdminUserCreate,
    RoleChangeRequest,
    Token,
    UserCreate,
    UserListResponse,
    UserResponse,
)
from app.services.auth import (
    authenticate_user,
    change_user_role,
    create_access_token,
    create_user,
    get_user_by_id,
    list_employees,
    login_identity_exists,
)
from app.utils.audit import write_audit

router = APIRouter(prefix="/auth", tags=["Authentication"])


# --------------------------------------------------
# REGISTER
# --------------------------------------------------
@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Self-registration (EMPLOYEE only)",
)
@limiter.limit(settings.RATE_LIMIT_REGISTER)
def register(request: Request, payload: UserCreate, db: Session = Depends(get_db)):
    """
    Public self-registration. ALWAYS creates an EMPLOYEE — role cannot be overridden by the client
    """
    if login_identity_exists(db, payload.username, payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or Email already taken",
        )

    try:
        return create_user(
            db=db,
            data=payload,
            role=UserRole.EMPLOYEE,
            created_by=None,
            request=request,
        )
    except IntegrityError:
        # Lost a race against another request — surface the same 409.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or Email already taken",
        )


# --------------------------------------------------
# LOGIN
# --------------------------------------------------
@router.post(
    "/login",
    response_model=Token,
    status_code=status.HTTP_200_OK,
    summary="Login with username or email",
)
@limiter.limit(settings.RATE_LIMIT_LOGIN)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """
    Login with username OR email + password. Returns a signed JWT.

    After `LOGIN_MAX_FAILED_ATTEMPTS` consecutive bad passwords the account
    is locked for `LOGIN_LOCKOUT_MINUTES`. While locked, even the correct
    password is rejected.
    """
    user, err = authenticate_user(
        db, form_data.username, form_data.password, request=request
    )

    if err == "locked":
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=(
                f"Account temporarily locked due to repeated failed login attempts. "
                f"Try again in {settings.LOGIN_LOCKOUT_MINUTES} minutes."
            ),
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user is None:
        # Generic 401 for both 'invalid' and 'inactive' — no user enumeration.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(user_id=user.id, role=user.role.value)
    return Token(access_token=access_token)


# --------------------------------------------------
# ME
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
# LIST EMPLOYEES (paginated)
# --------------------------------------------------
@router.get(
    "/employees",
    response_model=UserListResponse,
    status_code=status.HTTP_200_OK,
    summary="List active employees (paginated)",
)
def get_all_employees(
    search: Optional[str] = Query(
        None, description="Case-insensitive match on name, username, or email"
    ),
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    """Used by admin UIs to populate searchable assignment dropdowns + tables."""
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 200:
        page_size = 50

    results, total = list_employees(
        db, page=page, page_size=page_size, search=search
    )
    return UserListResponse(
        total=total, page=page, page_size=page_size, results=results
    )


# --------------------------------------------------
# EMPLOYEE MANAGEMENT
# --------------------------------------------------
@router.post(
    "/employee",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new Employee account",
)
def create_employee_account(
    request: Request,
    payload: AdminUserCreate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    if login_identity_exists(db, payload.username, payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or Email already taken",
        )

    try:
        return create_user(
            db=db,
            data=payload,
            role=UserRole.EMPLOYEE,  # trusted; never read from payload
            created_by=current_admin.id,
            request=request,
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or Email already taken",
        )


@router.delete(
    "/employee/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove an Employee account",
)
def remove_employee_account(
    request: Request,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    if user_id == current_admin.id:
        # Defense-in-depth: an EMPLOYEE-targeted endpoint hit by self.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot delete your own account.",
        )

    user_to_delete = get_user_by_id(db, user_id)
    if not user_to_delete or user_to_delete.role != UserRole.EMPLOYEE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found"
        )

    # Centralized soft-delete (#20) — also flips is_active=False (User override)
    # and keeps the is_deleted/deleted_at CHECK invariant.
    user_to_delete.soft_delete(current_admin.id)

    write_audit(
        db,
        action_type="USER_DELETE",
        target_table="users",
        record_id=user_to_delete.id,
        user_id=current_admin.id,
        old_data={
            "username": user_to_delete.username,
            "email": user_to_delete.email,
            "role": user_to_delete.role.value,
        },
        request=request,
    )
    db.commit()
    return None


# --------------------------------------------------
# ADMIN MANAGEMENT
# --------------------------------------------------
@router.post(
    "/admin",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new Admin account",
)
def create_admin_account(
    request: Request,
    payload: AdminUserCreate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    """Both Admin and Super Admin can create Admins. Role is forced to ADMIN."""
    if login_identity_exists(db, payload.username, payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or Email already taken",
        )

    try:
        return create_user(
            db=db,
            data=payload,
            role=UserRole.ADMIN,  # trusted; never read from payload
            created_by=current_admin.id,
            request=request,
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or Email already taken",
        )


@router.delete(
    "/admin/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove an Admin account (SUPER ADMIN only)",
)
def remove_admin_account(
    request: Request,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_super_admin: User = Depends(require_super_admin),
):
    """Only SUPER_ADMIN can remove an Admin. Self-delete is blocked."""
    if user_id == current_super_admin.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot delete your own account.",
        )

    user_to_delete = get_user_by_id(db, user_id)
    if not user_to_delete or user_to_delete.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Admin not found"
        )

    user_to_delete.soft_delete(current_super_admin.id)

    write_audit(
        db,
        action_type="USER_DELETE",
        target_table="users",
        record_id=user_to_delete.id,
        user_id=current_super_admin.id,
        old_data={
            "username": user_to_delete.username,
            "email": user_to_delete.email,
            "role": user_to_delete.role.value,
        },
        request=request,
    )
    db.commit()
    return None


# --------------------------------------------------
# ROLE CHANGE (#13) — SUPER_ADMIN only; EMPLOYEE <-> ADMIN
# --------------------------------------------------
@router.patch(
    "/users/{user_id}/role",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Change a user's role (SUPER ADMIN only)",
)
def change_role(
    request: Request,
    user_id: uuid.UUID,
    payload: RoleChangeRequest,
    db: Session = Depends(get_db),
    current_super_admin: User = Depends(require_super_admin),
):
    """
    Only SUPER_ADMIN may change roles, and only between EMPLOYEE and ADMIN.

    Hard rules (defense-in-depth; schema already blocks SUPER_ADMIN as a
    target role):
      - Cannot change your own role.
      - Cannot modify a SUPER_ADMIN account.
      - Target must be an existing active user.
    """
    if user_id == current_super_admin.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot change your own role.",
        )

    target = get_user_by_id(db, user_id)
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    if target.role == UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A SUPER_ADMIN account cannot be modified.",
        )

    if target.role == payload.role:
        # No-op: nothing to change, nothing to audit.
        return target

    # A2: the schema (RoleChangeRequest._no_super_admin) already rejects
    # `role=SUPER_ADMIN` at the boundary with a 422, and the service
    # (change_user_role) has a defense-in-depth check that raises
    # ValueError for the same case. We catch that ValueError here so a
    # service-to-service call that bypassed the schema doesn't surface
    # as a 500. Empirically unreachable via HTTP, but keeps the route
    # contract honest.
    try:
        return change_user_role(
            db,
            target,
            payload.role,
            actor_id=current_super_admin.id,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        )
