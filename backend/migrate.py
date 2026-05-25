"""
Migration runner.

Usage (from backend/):
    python migrate.py status   # show pending vs. applied
    python migrate.py apply    # apply all pending migrations
    python migrate.py apply --version 011  # apply just one

What it does
------------
- Scans backend/migrations/ for files matching `NNN_*.sql` (lexically sorted).
- Connects to the DB using settings.DATABASE_URL.
- Compares against the schema_migrations table.
- For each pending file: opens a transaction, executes the file, records
  (version, filename, sha256, applied_at, applied_by) in schema_migrations,
  and commits. Failure rolls back ONLY that file — earlier successes stay.

What it deliberately does NOT do
--------------------------------
- It does not parse SQL. The file is sent verbatim to psycopg2. Use one
  BEGIN/COMMIT pair INSIDE the file if you need transactional semantics
  beyond "this whole file is one statement batch".
- It does not re-apply or roll back migrations. Down-migrations are not a
  concept here: once a file is in production it is permanent. Mistakes
  are fixed by a NEW migration with a higher number.
- It does not check file hashes against the recorded SHA-256 — only WARNS
  if they differ. This is by design: backfilled rows have NULL hashes,
  and SQL files sometimes get reformatted by editors without semantic
  change.

Exit codes
----------
- 0  success (everything applied or nothing pending)
- 1  apply failed (one or more migrations errored)
- 2  bad CLI args / configuration error
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# Configure a minimal logger before any imports that might set up logging.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("migrate")

# Defer settings import so a missing .env doesn't crash --help.
_MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_FILENAME_RE = re.compile(r"^(\d{3,})_.+\.sql$")


@dataclass(frozen=True)
class Migration:
    version: str            # e.g. "010"
    filename: str           # e.g. "010_schema_migrations_tracker.sql"
    path: Path
    sha256: str


def discover_migrations() -> list[Migration]:
    """Return all NNN_*.sql files under migrations/, lexically sorted by version."""
    if not _MIGRATIONS_DIR.is_dir():
        raise FileNotFoundError(f"migrations directory missing: {_MIGRATIONS_DIR}")

    out: list[Migration] = []
    for p in sorted(_MIGRATIONS_DIR.iterdir()):
        if not p.is_file():
            continue
        m = _FILENAME_RE.match(p.name)
        if not m:
            continue
        body = p.read_bytes()
        out.append(
            Migration(
                version=m.group(1),
                filename=p.name,
                path=p,
                sha256=hashlib.sha256(body).hexdigest(),
            )
        )

    # Detect duplicate version prefixes — easy to do accidentally
    # ("011_a.sql" and "011_b.sql"). Fail loudly.
    seen: dict[str, str] = {}
    for mig in out:
        if mig.version in seen:
            raise ValueError(
                f"duplicate migration version {mig.version!r}: "
                f"{seen[mig.version]} and {mig.filename}"
            )
        seen[mig.version] = mig.filename
    return out


def _connect():
    """Open a fresh psycopg2 connection from settings. Imported lazily."""
    from app.core.config import settings
    import psycopg2

    # psycopg2 doesn't speak SQLAlchemy URLs directly; settings exposes a
    # SQLAlchemy URL, but psycopg2 accepts the same DSN minus the driver
    # qualifier ("postgresql+psycopg2://" -> "postgresql://").
    dsn = settings.DATABASE_URL.replace("postgresql+psycopg2://", "postgresql://", 1)
    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    return conn


def _ensure_tracker_table(conn) -> bool:
    """Return True if schema_migrations exists; False otherwise.

    We do NOT create it here — migration 010 is the canonical place that
    creates it. The runner just checks. If 010 hasn't been applied yet
    and someone runs `migrate.py apply`, the runner will execute 010
    (and every other pending file) in order.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT to_regclass('public.schema_migrations') IS NOT NULL"
        )
        return bool(cur.fetchone()[0])


def _fetch_applied(conn) -> dict[str, dict]:
    """Return {version: {filename, sha256}} of applied migrations."""
    if not _ensure_tracker_table(conn):
        return {}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT version, filename, sha256 FROM schema_migrations"
        )
        return {
            row[0]: {"filename": row[1], "sha256": row[2]}
            for row in cur.fetchall()
        }


def cmd_status() -> int:
    """Print one line per migration: applied vs. pending."""
    migrations = discover_migrations()
    conn = _connect()
    try:
        applied = _fetch_applied(conn)
    finally:
        conn.close()

    print(f"{'STATUS':<8} {'VERSION':<8} FILENAME")
    print("-" * 60)
    pending = 0
    drift = 0
    for mig in migrations:
        rec = applied.get(mig.version)
        if rec is None:
            status = "PENDING"
            pending += 1
        else:
            status = "OK"
            if rec["sha256"] and rec["sha256"] != mig.sha256:
                status = "DRIFT"
                drift += 1
        print(f"{status:<8} {mig.version:<8} {mig.filename}")

    print("-" * 60)
    print(f"{pending} pending, {drift} drift, {len(migrations)} total")
    return 0


def _apply_one(conn, mig: Migration, applied_by: str) -> None:
    """Apply a single migration inside its own transaction."""
    sql = mig.path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        try:
            cur.execute(sql)
            # Record AFTER the SQL succeeds. If the SQL file contains its
            # own COMMIT (most of ours do), psycopg2 has already committed
            # — but the insert below opens an implicit new transaction and
            # we COMMIT it at the bottom. ON CONFLICT in case the file
            # itself recorded the row (e.g. migration 010's backfill).
            cur.execute(
                """
                INSERT INTO schema_migrations
                    (version, filename, sha256, applied_by)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (version) DO UPDATE
                  SET sha256 = COALESCE(schema_migrations.sha256, EXCLUDED.sha256),
                      applied_by = COALESCE(schema_migrations.applied_by, EXCLUDED.applied_by)
                """,
                (mig.version, mig.filename, mig.sha256, applied_by),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def cmd_apply(only_version: Optional[str] = None) -> int:
    migrations = discover_migrations()
    if only_version is not None:
        migrations = [m for m in migrations if m.version == only_version]
        if not migrations:
            logger.error("no migration matches --version=%s", only_version)
            return 2

    conn = _connect()
    applied_by = os.environ.get("USER") or os.environ.get("USERNAME") or "unknown"
    failures = 0
    try:
        applied = _fetch_applied(conn)
        to_run = [m for m in migrations if m.version not in applied]

        if not to_run:
            logger.info("nothing to apply (%d already recorded)", len(applied))
            return 0

        for mig in to_run:
            logger.info("applying %s ...", mig.filename)
            try:
                _apply_one(conn, mig, applied_by=applied_by)
                logger.info("  ✓ %s", mig.filename)
            except Exception as exc:  # noqa: BLE001 — caller wants the message
                logger.error("  ✗ %s FAILED: %s", mig.filename, exc)
                failures += 1
                # Stop on first failure; later migrations may depend on
                # this one having succeeded.
                break

        # Re-warn if any APPLIED row has drift after the run.
        applied_after = _fetch_applied(conn)
        for mig in migrations:
            rec = applied_after.get(mig.version)
            if rec and rec["sha256"] and rec["sha256"] != mig.sha256:
                logger.warning(
                    "%s recorded sha256 differs from file on disk — "
                    "file was edited post-apply",
                    mig.filename,
                )
    finally:
        conn.close()
    return 0 if failures == 0 else 1


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="migrate",
        description="Apply schema migrations under backend/migrations/.",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="show applied vs pending")
    apply = sub.add_parser("apply", help="apply pending migrations in order")
    apply.add_argument(
        "--version",
        help="apply only this version (e.g. 011). Useful for forced reapply paired with manual cleanup.",
    )
    args = parser.parse_args(argv)

    try:
        if args.cmd == "status":
            return cmd_status()
        if args.cmd == "apply":
            return cmd_apply(only_version=getattr(args, "version", None))
    except Exception as exc:  # noqa: BLE001
        logger.error("migration runner aborted: %s", exc)
        return 2

    return 2


if __name__ == "__main__":
    sys.exit(main())
