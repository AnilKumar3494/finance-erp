import uuid
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
# CREATE — role auto-assigned by service
# --------------------------------------------------
class UserCreate(UserBase):
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
# ADMIN CREATE — allows explicit role assignment
# Only used by admin-only routes
# --------------------------------------------------
class AdminUserCreate(UserCreate):
    role: UserRole = UserRole.EMPLOYEE


# --------------------------------------------------
# LOGIN
# --------------------------------------------------
class UserLogin(BaseModel):
    login: str = Field(..., description="Username or Email")
    password: str


# --------------------------------------------------
# RESPONSE
# --------------------------------------------------
class UserResponse(UserBase):
    id: uuid.UUID
    role: UserRole
    is_active: bool
    is_deleted: bool

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
