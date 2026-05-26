-- =============================================================
-- Migration 010: schema_migrations tracker + backfill
-- Date: 2026-05-25
-- =============================================================
-- Stops "did I apply 007 in staging?" guesswork. After this migration,
-- every SQL file under backend/migrations/ that follows the NNN_*.sql
-- naming convention is tracked here with its SHA-256 and an applied_at
-- timestamp. The companion CLI (backend/migrate.py) is the only thing
-- that should INSERT into this table.
--
-- Pre-MVP migrations 001..009 were applied by hand; we backfill them as
-- already-applied here so the runner doesn't try to re-execute them.
-- The hash column is left NULL for the backfilled rows because the SQL
-- file on disk may have been edited after application — the runner
-- only enforces a hash match for migrations IT applied itself.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    filename    TEXT NOT NULL,
    sha256      TEXT,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by  TEXT
);

COMMENT ON TABLE schema_migrations IS
    'Tracks every applied migration. Managed exclusively by backend/migrate.py.';
COMMENT ON COLUMN schema_migrations.version IS
    'Numeric prefix of the migration filename (e.g. "001"). Primary key.';
COMMENT ON COLUMN schema_migrations.sha256 IS
    'SHA-256 of the migration file at apply time. NULL for backfilled rows.';

-- Backfill the migrations that were applied by hand before this tracker
-- existed. ON CONFLICT DO NOTHING so this migration is idempotent and
-- safe to re-run.
INSERT INTO schema_migrations (version, filename, applied_by) VALUES
    ('001', '001_customer_flow_redesign.sql',          'backfill'),
    ('002', '002_auth_hardening.sql',                  'backfill'),
    ('003', '003_customer_hardening.sql',              'backfill'),
    ('004', '004_loan_lifecycle_redesign.sql',         'backfill'),
    ('005', '005_audit_fixes.sql',                     'backfill'),
    ('006', '006_loan_closure_fk_fix.sql',             'backfill'),
    ('007', '007_vehicle_plate_partial_unique.sql',    'backfill'),
    ('008', '008_vehicle_plate_trgm_index.sql',        'backfill'),
    ('009', '009_docs_identity_stability_hardening.sql','backfill')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- =============================================================
-- Verify:
--   SELECT version, filename, applied_at FROM schema_migrations
--   ORDER BY version;
--   -- expected: 9 rows (001..009) plus this migration once the
--   --           runner records it.
-- =============================================================
