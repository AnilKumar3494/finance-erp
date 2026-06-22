"""Schema-migration drift detection.

Single source of truth for "is the DB schema in sync with the migration
files on disk", shared by:
  - the startup fail-fast check in main.py (refuse to boot when behind), and
  - the GET /migrations endpoint + the /readyz readiness probe.

Why this exists
---------------
A migration that ships in code but is never applied to a given database
(the classic "pulled the code, forgot `migrate.py apply`" case) surfaces as
scattered 500s on every endpoint that touches the changed table — an
expensive thing to diagnose from the frontend. This module turns that
silent drift into a loud, single signal.

It reuses migrate.discover_migrations() so there is exactly one definition
of "what counts as a migration" (the NNN_*.sql files under backend/migrations/).
"""
from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import text

from app.core.db import engine

# migrate.py lives at the backend/ root (sibling of the app/ package), not on
# the package path. Make it importable regardless of the process cwd so this
# works under `uvicorn main:app`, `python main.py`, and pytest alike.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


def migration_state() -> dict:
    """Compare migration files on disk against the schema_migrations table.

    Returns:
        {
          "applied_count": int,     # rows in schema_migrations
          "expected_count": int,    # NNN_*.sql files on disk
          "latest_version": str|None,
          "pending": [filename...], # on disk, not yet applied
          "drift":   [filename...], # applied but file changed post-apply
        }

    pending != [] means the DB schema is behind the code.
    """
    from migrate import discover_migrations  # lazy: avoids import at module load

    migrations = discover_migrations()

    with engine.connect() as conn:
        tracker_exists = conn.execute(
            text("SELECT to_regclass('public.schema_migrations') IS NOT NULL")
        ).scalar()
        if tracker_exists:
            rows = conn.execute(
                text("SELECT version, sha256 FROM schema_migrations")
            ).fetchall()
            applied = {row[0]: row[1] for row in rows}
        else:
            applied = {}

    pending = [m.filename for m in migrations if m.version not in applied]
    # Drift only when the file's hash differs from a RECORDED hash. Backfilled
    # rows carry NULL sha256 (see migrate.py) — those are not drift.
    drift = [
        m.filename
        for m in migrations
        if applied.get(m.version) and applied[m.version] != m.sha256
    ]

    return {
        "applied_count": len(applied),
        "expected_count": len(migrations),
        "latest_version": migrations[-1].version if migrations else None,
        "pending": pending,
        "drift": drift,
    }
