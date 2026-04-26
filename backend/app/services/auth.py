import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User, UserRole
from app.schemas.user import TokenData, UserCreate

# --------------------------------------------------
# PASSWORD HASHING
# --------------------------------------------------
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Convert plain password → bcrypt hash for storage"""
    return pwd_context.hash(password[:72])


def verify_password(plain: str, hashed: str) -> bool:
    """Compare login attempt against stored hash"""
    return pwd_context.verify(plain[:72], hashed)


# --------------------------------------------------
# JWT TOKENS
# --------------------------------------------------
def create_access_token(
    user_id: uuid.UUID, role: str, expires_delta: Optional[timedelta] = None
) -> str:
    """
    Build and sign a JWT containing user_id + role.
    Expiry defaults to ACCESS_TOKEN_EXPIRE_MINUTES from config.
    """
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    payload = {
        "sub": str(user_id),  # Subject — who this token belongs to
        "role": role,  # For route-level permission checks
        "exp": expire,  # Expiry — jose validates this automatically
    }

    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> Optional[TokenData]:
    """
    Decode and validate a JWT.
    Returns TokenData if valid, None if expired or tampered.
    """
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        user_id = payload.get("sub")
        role = payload.get("role")

        if user_id is None:
            return None

        return TokenData(user_id=uuid.UUID(user_id), role=role)

    except JWTError:
        return None


# --------------------------------------------------
# USER OPERATIONS
# --------------------------------------------------
def get_user_by_login(db: Session, login: str) -> Optional[User]:
    """
    Find user by username OR email in a single query.
    Used during login — user can provide either.
    """
    return (
        db.query(User).filter(or_(User.username == login, User.email == login)).first()
    )


def get_user_by_id(db: Session, user_id: uuid.UUID) -> Optional[User]:
    """Fetch a single active user by UUID — used by JWT guard"""
    return (
        db.query(User)
        .filter(User.id == user_id, User.is_active == True, User.is_deleted == False)
        .first()
    )


def create_user(
    db: Session, data: UserCreate, created_by: Optional[uuid.UUID] = None
) -> User:
    """
    Register a new user.
    - All new users are defaulted to Employee but default
    - Hashes password before storage
    - Never stores plain text
    """

    existing_users = db.query(User).count()

    if hasattr(data, "role") and existing_users > 0:
        assigned_role = data.role
    else:
        assigned_role = UserRole.ADMIN if existing_users == 0 else UserRole.EMPLOYEE

    user = User(
        username=data.username,
        email=data.email,
        full_name=data.full_name,
        role=assigned_role,
        password_hash=hash_password(data.password),
        created_by_id=created_by,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, login: str, password: str) -> Optional[User]:
    """
    Full login check:
    1. Find user by username or email
    2. Verify password hash
    3. Check account is active and not deleted
    Returns User if all pass, None if anything fails
    """
    user = get_user_by_login(db, login)

    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    if not user.is_active or user.is_deleted:
        return None

    return user
