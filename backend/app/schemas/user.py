import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.user import UserRole


# --------------------------------------------------
# BASE
# --------------------------------------------------
class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    full_name: Optional[str] = Field(None, max_length=100)


# --------------------------------------------------
# PASSWORD MIX-IN
# --------------------------------------------------
class _PasswordMixin(BaseModel):
    password: str = Field(..., min_length=8, max_length=64)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number")
        return v


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
