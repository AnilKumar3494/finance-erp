-- =============================================================
-- Migration 017: add customers.branch_point (branch sub-office)
-- Date: 2026-07-02
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- Why
-- ---
-- The Assignment section on the customer shows who collects (assigned
-- employee / route line). It should also show the BRANCH POINT — the branch
-- sub-office the customer belongs to (e.g. TADEPALLIGUDEM, NIDADAVOLE, TANUKU,
-- ELURU). This is carried over from the legacy iFinanceBooks loan `b_point`
-- during migration. Free text (no lookup table) so the office list can grow
-- without a schema change, mirroring how the route/collector is a plain name.
-- Nullable — customers created outside the migration may not have one yet.
-- =============================================================

BEGIN;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS branch_point VARCHAR(100);

-- Post-flight: confirm the column exists.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'customers' AND column_name = 'branch_point'
    ) THEN
        RAISE EXCEPTION 'customers.branch_point missing after migration';
    END IF;
END
$$;

COMMIT;

-- =============================================================
-- Verify:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name='customers' AND column_name='branch_point';
--   -- character varying, YES
-- =============================================================
