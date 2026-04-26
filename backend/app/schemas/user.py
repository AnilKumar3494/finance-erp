import uuid
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator
from app.models.user import UserRole


# --------------------------------------------------
# BASE (Shared fields)
# --------------------------------------------------
class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    full_name: Optional[str] = Field(None, max_length=100)
    role: UserRole = UserRole.EMPLOYEE


# --------------------------------------------------
# CREATE (What we accept on registration)
# --------------------------------------------------
class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=64)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) > 64:  # Enforce max before hitting bcrypt limit
            raise ValueError("Password must be 64 characters or less")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number")
        return v


# --------------------------------------------------
# LOGIN (Either username or email + password)
# --------------------------------------------------
class UserLogin(BaseModel):
    login: str = Field(..., description="Username or Email")
    password: str


# --------------------------------------------------
# RESPONSE (What we send back — never expose password)
# --------------------------------------------------
class UserResponse(UserBase):
    id: uuid.UUID
    is_active: bool
    is_deleted: bool

    model_config = {"from_attributes": True}


# --------------------------------------------------
# TOKEN (JWT response after login)
# --------------------------------------------------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    user_id: Optional[uuid.UUID] = None
    role: Optional[UserRole] = None
