-- =============================================================
-- Migration 013: add WITH_CUSTOMER to asset_status
-- Date: 2026-06-02
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- Why
-- ---
-- The New Finance flow lets a field employee create a loan's collateral on
-- the spot. The vehicle physically stays with the hirer, so its asset_status
-- starts as WITH_CUSTOMER (then moves to SEIZED / IN_YARD / etc. as the loan
-- lifecycle dictates). The enum had no such value.
--
-- Why a rebuild and not ALTER TYPE ... ADD VALUE
-- ----------------------------------------------
-- migrate.py runs each file inside a psycopg2 transaction (autocommit=False).
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on
-- PostgreSQL < 12, and even where allowed the new value is unusable until
-- commit. The rename-aside / recreate / cast pattern (same as migration 012,
-- which removed a value) is transaction-safe on every supported version and
-- gives us deterministic enum ordering. vehicles.status is the only column
-- of this type; its DEFAULT references the type, so we drop and re-add it
-- around the swap.
-- =============================================================

BEGIN;

-- 1. The column DEFAULT ('IN_YARD'::asset_status) references the type we are
--    about to replace; drop it first, restore it after the swap.
ALTER TABLE vehicles ALTER COLUMN status DROP DEFAULT;

-- 2. Rebuild asset_status with the new value appended.
ALTER TYPE asset_status RENAME TO asset_status_old;

CREATE TYPE asset_status AS ENUM (
    'IN_YARD',
    'SEIZED',
    'MAINTENANCE',
    'SOLD',
    'WITH_CUSTOMER'
);

-- 3. Convert the column across via text. Every existing value is present in
--    the new enum, so the cast cannot lose data.
ALTER TABLE vehicles
    ALTER COLUMN status TYPE asset_status
    USING status::text::asset_status;

-- 4. Restore the default and drop the old type. DROP TYPE fails loudly if any
--    other object still depends on asset_status_old (none expected).
ALTER TABLE vehicles ALTER COLUMN status SET DEFAULT 'IN_YARD'::asset_status;

DROP TYPE asset_status_old;

-- 5. Post-flight: confirm the value now exists.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'asset_status'
           AND e.enumlabel = 'WITH_CUSTOMER'
    ) THEN
        RAISE EXCEPTION 'asset_status is missing WITH_CUSTOMER after rebuild';
    END IF;
END
$$;

COMMIT;

-- =============================================================
-- Verify:
--   SELECT enumlabel FROM pg_enum
--     JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
--    WHERE pg_type.typname = 'asset_status'
--    ORDER BY enumsortorder;
--   -- expected 5 rows, including WITH_CUSTOMER
-- =============================================================
