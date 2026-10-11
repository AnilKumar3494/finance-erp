"""
Create a SUPER_ADMIN user directly in this deployment's database.

The API refuses to create SUPER_ADMINs on purpose (see create_user() in
app/services/auth.py), so the first super admin of a new franchise database,
or a recovery account when every super admin is locked out, comes from here.
Access control is whoever can read this deployment's env file (DB
credentials); there is no API route behind this.

Run from the backend root, with the target deployment's env:
  python scripts/create_superadmin.py            # inside the container
  docker run --rm -it --env-file /srv/finerp/env/<slug>.env \\
      finerp-api:production python scripts/create_superadmin.py

Refuses when an active SUPER_ADMIN already exists unless --force is given.
Prints the target database and asks for "yes" before writing.
"""
import argparse
import getpass
import os
import sys

# Running as `python scripts/x.py` puts scripts/ on sys.path, not the backend
# root; add the root so `main` and `app.*` import.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # noqa: E402,F401  registers all mappers

from pydantic import ValidationError  # noqa: E402
from sqlalchemy import or_, select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.schemas.user import UserCreate  # noqa: E402
from app.services.auth import hash_password  # noqa: E402
from app.utils.audit import write_audit  # noqa: E402


def _prompt(label: str) -> str:
    value = input(f"{label}: ").strip()
    if not value:
        sys.exit(f"{label} is required.")
    return value


def main_cli() -> int:
    parser = argparse.ArgumentParser(description="Create a SUPER_ADMIN user.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="create one even if an active SUPER_ADMIN already exists",
    )
    args = parser.parse_args()

    print(f"Target database: {settings.DB_NAME} on {settings.DB_HOST}:{settings.DB_PORT}")

    db = SessionLocal()
    try:
        existing = db.scalars(
            select(User.username).where(
                User.role == UserRole.SUPER_ADMIN,
                User.is_active == True,  # noqa: E712
                User.is_deleted == False,  # noqa: E712
            )
        ).all()
        if existing and not args.force:
            print(f"Active SUPER_ADMIN already exists: {', '.join(existing)}")
            print("Refusing. Re-run with --force to add another.")
            return 1

        username = _prompt("Username")
        email = _prompt("Email")
        full_name = _prompt("Full name")
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Repeat password: "):
            print("Passwords do not match.")
            return 1

        # Same username/email/password rules as accounts created through the API.
        try:
            data = UserCreate(
                username=username, email=email, full_name=full_name, password=password
            )
        except ValidationError as exc:
            for err in exc.errors():
                print(f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}")
            return 1

        clash = db.scalar(
            select(User.username).where(
                or_(User.username == data.username, User.email == data.email)
            )
        )
        if clash:
            print("That username or email is already taken.")
            return 1

        if input(f"Create SUPER_ADMIN '{data.username}' in {settings.DB_NAME}? Type yes: ") != "yes":
            print("Aborted.")
            return 1

        user = User(
            username=data.username,
            email=data.email,
            full_name=data.full_name,
            role=UserRole.SUPER_ADMIN,
            password_hash=hash_password(data.password),
        )
        db.add(user)
        db.flush()
        write_audit(
            db,
            action_type="USER_CREATE",
            target_table="users",
            record_id=user.id,
            new_data={
                "username": user.username,
                "email": user.email,
                "role": user.role.value,
                "source": "create_superadmin.py",
            },
        )
        db.commit()
        print(f"Created SUPER_ADMIN '{user.username}' ({user.id}).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main_cli())
