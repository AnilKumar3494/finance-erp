"""
Fresh-database initializer (dev / test / new-environment bootstrap).

WHY THIS EXISTS
---------------
The numbered migrations in ``backend/migrations`` were authored as a chain of
*transformations* on top of a schema that predates migration 001 — 001 itself
is a "redesign" that ALTERs tables and enums it never creates. As a result,
``python migrate.py apply`` against a genuinely empty database fails at 001
with e.g. ``type "doc_category" does not exist``, and the startup fail-fast
then refuses to boot. Production works only because its database predates the
migration chain; a fresh deploy, CI database, or disaster-recovery restore has
no way in.

This script provides that way in WITHOUT touching the existing migration flow:

  1. Creates every enum type the models use (``create_type=False`` on the
     columns means ``create_all`` will not emit them).
  2. ``Base.metadata.create_all`` — all tables + model-declared indexes.
  3. Replays the partial-UNIQUE indexes that live only in the migration SQL
     (``create_all`` cannot express ``WHERE is_deleted = false`` filters, so
     the ORM models declare those columns as plain indexes). These are the
     integrity guards the API relies on for duplicate detection.
  4. Stamps every ``migrations/NNN_*.sql`` file as applied in
     ``schema_migrations`` so ``migrate.py status`` reports a clean, in-sync
     database and the startup fail-fast passes.

Existing databases are unaffected: they keep using ``migrate.py apply`` as
before. This script is for standing up a NEW database only.

USAGE (from backend/)
---------------------
    python -m scripts.init_db            # build schema + stamp migrations
    python -m scripts.init_db --with-admin
        # additionally seed a SUPER_ADMIN from BOOTSTRAP_ADMIN_USERNAME /
        # BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD env vars.

It is idempotent: every statement uses IF NOT EXISTS / ON CONFLICT, so
re-running is safe.

NOTE ON FIDELITY
----------------
``create_all`` produces a schema functionally equivalent to the migrated one
for application purposes (all tables, columns, enums, and the duplicate-guard
indexes below). It is NOT a byte-for-byte match with a ``pg_dump`` of
production — if you need an exact production replica (every trigger, every
check constraint name), take a ``pg_dump --schema-only`` of prod instead. For
dev/test/CI, this is the intended tool.
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from pathlib import Path

import sqlalchemy as sa

# Importing the app package registers every ORM mapper (routes -> services ->
# models). We import the models directly to avoid pulling in the web app.
import app.models.audit_log  # noqa: F401
import app.models.bad_debt_proposal  # noqa: F401
import app.models.cash_entry  # noqa: F401
import app.models.customer  # noqa: F401
import app.models.document  # noqa: F401
import app.models.due_cycle  # noqa: F401
import app.models.identity_proof  # noqa: F401
import app.models.loan  # noqa: F401
import app.models.loan_closure  # noqa: F401
import app.models.penalty_event  # noqa: F401
import app.models.personnel  # noqa: F401
import app.models.stability_document  # noqa: F401
import app.models.transaction  # noqa: F401
import app.models.user  # noqa: F401
import app.models.vehicle  # noqa: F401
from app.core.db import Base, engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("init_db")

_MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
_FILENAME_RE = re.compile(r"^(\d{3,})_.+\.sql$")

# Partial-UNIQUE indexes that exist ONLY in the migration SQL. The ORM models
# declare the underlying columns as plain indexes (SQLAlchemy cannot express a
# `WHERE is_deleted = false` filtered unique index portably), so create_all
# does not reproduce them. The API depends on these for 409 duplicate
# detection. Kept verbatim (IF NOT EXISTS) from the migration files.
_PARTIAL_UNIQUE_INDEXES = [
    # 003_customer_hardening
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_mobile_active "
    "ON customers (mobile_number) WHERE (is_deleted = false)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_aadhaar_active "
    "ON customers (aadhaar_number) WHERE (is_deleted = false AND aadhaar_number IS NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_pan_active "
    "ON customers (pan_number) WHERE (is_deleted = false AND pan_number IS NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_idempotency_key "
    "ON customers (idempotency_key) WHERE (idempotency_key IS NOT NULL)",
    # 007_vehicle_plate_partial_unique
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_plate_number_active "
    "ON vehicles (plate_number) WHERE is_deleted = false",
    # 005_audit_fixes
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_idempotency_key_per_loan "
    "ON transactions (loan_id, idempotency_key) "
    "WHERE (idempotency_key IS NOT NULL AND is_deleted = FALSE)",
    # 004_loan_lifecycle_redesign
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_due_cycles_loan_cycle_active "
    "ON due_cycles (loan_id, cycle_number) WHERE is_deleted = FALSE",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_closures_loan_active "
    "ON loan_closures (loan_id) WHERE is_deleted = FALSE AND superseded_by_id IS NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_bad_debt_proposals_open "
    "ON bad_debt_proposals (loan_id) WHERE status = 'PROPOSED' AND is_deleted = FALSE",
    # 009_docs_identity_stability_hardening
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_proofs_customer_type_active "
    "ON identity_proofs (customer_id, proof_type) "
    "WHERE is_deleted = false AND customer_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_proofs_personnel_type_active "
    "ON identity_proofs (personnel_id, proof_type) "
    "WHERE is_deleted = false AND personnel_id IS NOT NULL",
]


def _create_enums(conn) -> int:
    enums: dict[str, tuple[str, ...]] = {}
    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, sa.Enum) and col.type.name:
                enums[col.type.name] = tuple(col.type.enums)
    for name, values in sorted(enums.items()):
        vals = ", ".join("'%s'" % v for v in values)
        conn.execute(
            sa.text(
                "DO $$ BEGIN CREATE TYPE %s AS ENUM (%s); "
                "EXCEPTION WHEN duplicate_object THEN NULL; END $$;" % (name, vals)
            )
        )
    return len(enums)


def _stamp_migrations(conn) -> int:
    conn.execute(
        sa.text(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "  version text PRIMARY KEY, filename text NOT NULL, sha256 text,"
            "  applied_at timestamptz NOT NULL DEFAULT now(), applied_by text)"
        )
    )
    count = 0
    for path in sorted(_MIGRATIONS_DIR.glob("*.sql")):
        m = _FILENAME_RE.match(path.name)
        if not m:
            continue
        conn.execute(
            sa.text(
                "INSERT INTO schema_migrations (version, filename, applied_by) "
                "VALUES (:v, :f, 'init_db') ON CONFLICT (version) DO NOTHING"
            ),
            {"v": m.group(1), "f": path.name},
        )
        count += 1
    return count


def _seed_admin() -> None:
    username = os.getenv("BOOTSTRAP_ADMIN_USERNAME")
    email = os.getenv("BOOTSTRAP_ADMIN_EMAIL")
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD")
    if not (username and email and password):
        logger.error(
            "--with-admin requires BOOTSTRAP_ADMIN_USERNAME, "
            "BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD env vars."
        )
        sys.exit(2)

    from app.core.db import SessionLocal
    from app.models.user import User, UserRole
    from app.services.auth import hash_password

    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == username).first():
            logger.info("admin %r already exists — skipping", username)
            return
        db.add(
            User(
                username=username,
                email=email,
                full_name=os.getenv("BOOTSTRAP_ADMIN_FULL_NAME", "Super Admin"),
                role=UserRole.SUPER_ADMIN,
                password_hash=hash_password(password),
            )
        )
        db.commit()
        logger.info("seeded SUPER_ADMIN %r", username)
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Initialize a fresh database.")
    parser.add_argument(
        "--with-admin",
        action="store_true",
        help="also seed a SUPER_ADMIN from BOOTSTRAP_ADMIN_* env vars",
    )
    args = parser.parse_args()

    with engine.begin() as conn:
        n_enums = _create_enums(conn)
        logger.info("created %d enum type(s)", n_enums)

    Base.metadata.create_all(engine)
    logger.info("created %d table(s)", len(Base.metadata.tables))

    with engine.begin() as conn:
        for stmt in _PARTIAL_UNIQUE_INDEXES:
            conn.execute(sa.text(stmt))
    logger.info("applied %d partial-unique index(es)", len(_PARTIAL_UNIQUE_INDEXES))

    with engine.begin() as conn:
        n_stamped = _stamp_migrations(conn)
    logger.info("stamped %d migration(s) as applied", n_stamped)

    if args.with_admin:
        _seed_admin()

    logger.info("database initialized. `python migrate.py status` should report 0 pending.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
