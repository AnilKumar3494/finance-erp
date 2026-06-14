import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.models.user import UserRole


# --------------------------------------------------
# ROLE CHANGE (SUPER_ADMIN only; EMPLOYEE <-> ADMIN)
# --------------------------------------------------
class RoleChangeRequest(BaseModel):
    role: UserRole

    @field_validator("role")
    @classmethod
    def _no_super_admin(cls, v: UserRole) -> UserRole:
        if v == UserRole.SUPER_ADMIN:
            raise ValueError("Role can only be set to ADMIN or EMPLOYEE")
        return v


# --------------------------------------------------
# BASE
# --------------------------------------------------
class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    full_name: Optional[str] = Field(None, max_length=100)


# --------------------------------------------------
# PASSWORD STRENGTH (shared rule)
# Single source of truth for the complexity policy so account creation and
# self-service password changes never drift apart.
# --------------------------------------------------
def _check_password_strength(v: str) -> str:
    if not any(c.isupper() for c in v):
        raise ValueError("Password must contain at least one uppercase letter")
    if not any(c.isdigit() for c in v):
        raise ValueError("Password must contain at least one number")
    return v


# --------------------------------------------------
# PASSWORD MIX-IN
# --------------------------------------------------
class _PasswordMixin(BaseModel):
    password: str = Field(..., min_length=8, max_length=64)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _check_password_strength(v)


# --------------------------------------------------
# CHANGE PASSWORD — self-service (any authenticated user).
#
# `new_password` carries the same complexity policy as account creation.
# `current_password` is only checked for presence here; correctness is
# verified against the stored hash in the service layer. Rejecting an
# unchanged password at the boundary keeps the 422 message clear.
# --------------------------------------------------
class PasswordChangeRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=64)

    @field_validator("new_password")
    @classmethod
    def new_password_strength(cls, v: str) -> str:
        return _check_password_strength(v)

    @model_validator(mode="after")
    def _new_differs_from_current(self) -> "PasswordChangeRequest":
        if self.current_password == self.new_password:
            raise ValueError("New password must be different from the current password")
        return self


# --------------------------------------------------
# ADMIN PASSWORD RESET — an admin/super-admin sets a NEW temporary password for
# another user (who forgot theirs). No current password is supplied: the admin
# doesn't know it. Same complexity policy as account creation. The caller-chosen
# value is revealed once to the admin to share; the server never returns it.
# Authorization (who may reset whom) is enforced in the route.
# --------------------------------------------------
class AdminPasswordResetRequest(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=64)

    @field_validator("new_password")
    @classmethod
    def new_password_strength(cls, v: str) -> str:
        return _check_password_strength(v)


# --------------------------------------------------
# CREATE — Public registration. Service forces role=EMPLOYEE.
# --------------------------------------------------
class UserCreate(UserBase, _PasswordMixin):
    pass


# --------------------------------------------------
# ADMIN CREATE — Used by admin-only employee/admin creation routes.
#
# SECURITY: `role` is INTENTIONALLY NOT a field here. The role is decided
# server-side by the route based on which endpoint was hit and who the
# caller is. This prevents any client from smuggling `role=SUPER_ADMIN`
# (or `role=ADMIN` via the /employee endpoint) in the request body.
# --------------------------------------------------
class AdminUserCreate(UserBase, _PasswordMixin):
    pass


# --------------------------------------------------
# LOGIN
#
# Kept for documentation / typed clients. The /login route itself consumes
# OAuth2PasswordRequestForm so that Swagger's "Authorize" flow works.
# Login accepts username OR email in the `login` field.
# --------------------------------------------------
class UserLogin(BaseModel):
    login: str = Field(..., description="Username or Email")
    password: str


# --------------------------------------------------
# RESPONSE
#
# `is_deleted` is intentionally NOT exposed. Soft-deleted users are filtered
# out before they ever reach the response layer, so callers don't need it.
# --------------------------------------------------
class UserResponse(UserBase):
    id: uuid.UUID
    role: UserRole
    is_active: bool

    model_config = {"from_attributes": True}


# --------------------------------------------------
# TOKEN
# --------------------------------------------------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    user_id: Optional[uuid.UUID] = None
    role: Optional[UserRole] = None


# --------------------------------------------------
# LIST RESPONSE (Paginated)
# --------------------------------------------------
class UserListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[UserResponse]
