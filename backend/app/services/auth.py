"""
Auth service layer.

Responsibilities:
  - Password hashing (bcrypt) with UTF-8 safe truncation.
  - JWT issuance / verification (single source of truth: `decode_access_token`).
  - User lookup (always excludes soft-deleted unless explicitly opted in).
  - Authentication with failed-attempt counter + temporary lockout.
  - User creation with TRUSTED role assignment — role is passed as a function
    argument, NEVER read from the request payload.

Audit logging:
  - This module records LOGIN_SUCCESS / LOGIN_FAIL / LOGIN_LOCKED / USER_CREATE.
  - Route layer records USER_DELETE / ROLE_CHANGE since it knows the request.
"""

import logging
import uuid
from datetime import timedelta
from typing import Optional, Union

from fastapi import Request
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User, UserRole
from app.schemas.user import AdminUserCreate, TokenData, UserCreate
from app.utils.audit import NO_RECORD, write_audit
from app.utils.time import utcnow

logger = logging.getLogger(__name__)

# --------------------------------------------------
# PASSWORD HASHING
# --------------------------------------------------
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# bcrypt hard limit (in BYTES, not characters).
_BCRYPT_MAX_BYTES = 72


def _bcrypt_safe(password: str) -> bytes:
    """
    bcrypt silently truncates anything past 72 BYTES. Multi-byte UTF-8
    characters can blow the limit even when the string is well under 72 chars.
    We truncate on the byte side so behaviour is stable across encodings.
    """
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    return pwd_context.hash(_bcrypt_safe(password))


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(_bcrypt_safe(plain), hashed)


# --------------------------------------------------
# JWT TOKENS
# --------------------------------------------------
def create_access_token(
    user_id: uuid.UUID, role: str, expires_delta: Optional[timedelta] = None
) -> str:
    """Sign a JWT containing user_id + role. Expiry honored by jose on decode."""
    expire = utcnow() + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> Optional[TokenData]:
    """
    Decode + verify a JWT. Returns TokenData if valid, None if invalid/expired.

    This is the SINGLE source of truth for JWT verification — both the
    dependency layer and any service that needs to introspect a token must
    go through here so validation logic never diverges.
    """
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
    except JWTError:
        return None

    sub = payload.get("sub")
    role = payload.get("role")
    if not sub:
        return None

    try:
        user_id = uuid.UUID(sub)
    except (ValueError, TypeError):
        return None

    # Role claim may be absent on legacy tokens; coerce safely.
    role_enum: Optional[UserRole] = None
    if role is not None:
        try:
            role_enum = UserRole(role)
        except ValueError:
            return None

    return TokenData(user_id=user_id, role=role_enum)


# --------------------------------------------------
# USER LOOKUP
# --------------------------------------------------
def get_user_by_login(
    db: Session, login: str, *, include_deleted: bool = False
) -> Optional[User]:
    """
    Find a user by username OR email.

    By default soft-deleted users are EXCLUDED. Pass `include_deleted=True`
    only when checking uniqueness on registration (so we don't recycle the
    identity of a deleted account).
    """
    q = db.query(User).filter(or_(User.username == login, User.email == login))
    if not include_deleted:
        q = q.filter(User.is_deleted == False)  # noqa: E712
    return q.first()


def get_user_by_id(db: Session, user_id: uuid.UUID) -> Optional[User]:
    """Fetch a single active, non-deleted user by UUID — used by the JWT guard."""
    return (
        db.query(User)
        .filter(
            User.id == user_id,
            User.is_active == True,  # noqa: E712
            User.is_deleted == False,  # noqa: E712
        )
        .first()
    )


def login_identity_exists(db: Session, username: str, email: str) -> bool:
    """
    True if ANY user (incl. soft-deleted) already owns this username/email.
    Used to surface a 409 before hitting the DB unique constraint.
    """
    return (
        db.query(User.id)
        .filter(or_(User.username == username, User.email == email))
        .first()
        is not None
    )


def list_employees(
    db: Session, page: int = 1, page_size: int = 50
) -> tuple[list[User], int]:
    """Paginated list of active employees. Used for assignment dropdowns."""
    query = db.query(User).filter(
        User.role == UserRole.EMPLOYEE,
        User.is_active == True,  # noqa: E712
        User.is_deleted == False,  # noqa: E712
    )
    total = query.count()
    results = (
        query.order_by(User.full_name.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return results, total


# --------------------------------------------------
# USER CREATION
# --------------------------------------------------
def create_user(
    db: Session,
    data: Union[UserCreate, AdminUserCreate],
    *,
    role: UserRole,
    created_by: Optional[uuid.UUID] = None,
    request: Optional[Request] = None,
) -> User:
    """
    Create a user with an EXPLICIT, trusted role.
    """
    if role == UserRole.SUPER_ADMIN:
        raise ValueError("SUPER_ADMIN cannot be created!")

    user = User(
        username=data.username,
        email=data.email,
        full_name=data.full_name,
        role=role,
        password_hash=hash_password(data.password),
        created_by_id=created_by,
    )
    db.add(user)
    db.flush()  # populate user.id without committing yet

    write_audit(
        db,
        action_type="USER_CREATE",
        target_table="users",
        record_id=user.id,
        user_id=created_by,
        new_data={
            "username": user.username,
            "email": user.email,
            "role": user.role.value,
        },
        request=request,
    )

    db.commit()
    db.refresh(user)
    return user


# --------------------------------------------------
# AUTHENTICATION (login)
# --------------------------------------------------
def _is_locked(user: User) -> bool:
    return user.locked_until is not None and user.locked_until > utcnow()


def authenticate_user(
    db: Session,
    login: str,
    password: str,
    *,
    request: Optional[Request] = None,
) -> tuple[Optional[User], Optional[str]]:
    """
    Full login flow with lockout + audit.

    Returns (user, error_code). On success: (User, None). On any failure:
    (None, error_code) where error_code ∈ {"invalid", "locked", "inactive"}.
    The route layer maps these to HTTP responses (a single generic 401 for
    `invalid` and `inactive` to prevent user enumeration; `locked` returns
    a distinct message so legitimate users know to wait).

    Side effects:
      - On wrong password: increments failed_login_attempts; locks the
        account once the threshold is reached.
      - On success: resets failed counter, sets last_login_at.
      - Writes LOGIN_FAIL / LOGIN_LOCKED / LOGIN_SUCCESS audit rows.
    """
    user = get_user_by_login(db, login)

    if not user:
        write_audit(
            db,
            action_type="LOGIN_FAIL",
            target_table="users",
            record_id=NO_RECORD,
            new_data={"login": login, "reason": "unknown_user"},
            request=request,
        )
        db.commit()
        return None, "invalid"

    # Account state checks BEFORE password verification — but we still record
    # an audit row. We don't leak the distinction in the HTTP response.
    if user.is_deleted or not user.is_active:
        write_audit(
            db,
            action_type="LOGIN_FAIL",
            target_table="users",
            record_id=user.id,
            user_id=user.id,
            new_data={"reason": "inactive_or_deleted"},
            request=request,
        )
        db.commit()
        return None, "inactive"

    if _is_locked(user):
        write_audit(
            db,
            action_type="LOGIN_LOCKED",
            target_table="users",
            record_id=user.id,
            user_id=user.id,
            new_data={"locked_until": user.locked_until.isoformat()},
            request=request,
        )
        db.commit()
        return None, "locked"

    if not verify_password(password, user.password_hash):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        reason = "bad_password"
        if user.failed_login_attempts >= settings.LOGIN_MAX_FAILED_ATTEMPTS:
            user.locked_until = utcnow() + timedelta(
                minutes=settings.LOGIN_LOCKOUT_MINUTES
            )
            reason = "threshold_reached_account_locked"
            write_audit(
                db,
                action_type="LOGIN_LOCKED",
                target_table="users",
                record_id=user.id,
                user_id=user.id,
                new_data={
                    "locked_until": user.locked_until.isoformat(),
                    "failed_attempts": user.failed_login_attempts,
                },
                request=request,
            )
        write_audit(
            db,
            action_type="LOGIN_FAIL",
            target_table="users",
            record_id=user.id,
            user_id=user.id,
            new_data={
                "reason": reason,
                "failed_attempts": user.failed_login_attempts,
            },
            request=request,
        )
        db.commit()
        # If we just locked the account, surface that to the caller.
        return None, (
            "locked"
            if user.locked_until and user.locked_until > utcnow()
            else "invalid"
        )

    # SUCCESS — reset counters, stamp last_login_at.
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    write_audit(
        db,
        action_type="LOGIN_SUCCESS",
        target_table="users",
        record_id=user.id,
        user_id=user.id,
        request=request,
    )
    db.commit()
    return user, None
