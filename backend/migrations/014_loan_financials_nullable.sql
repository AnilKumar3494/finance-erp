-- =============================================================
-- Migration 014: make loan financial terms nullable for DRAFT
-- Date: 2026-06-02
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- Why
-- ---
-- The New Finance wizard creates a finance as a DRAFT the moment a customer is
-- chosen, so that loan-scoped artifacts (stability documents, personnel links,
-- loan documents) can attach to a real loan_id while the employee works
-- through the sections. The financial terms (principal, interest_rate, tenure)
-- are entered LAST. They therefore must be nullable on a DRAFT row.
--
-- They remain mandatory at approval: services/loan.approve_loan rejects a DRAFT
-- whose principal / interest_rate / tenure is NULL, so no ACTIVE loan can exist
-- without a complete schedule. Any existing positive-value CHECK constraints
-- still hold for non-NULL rows (a CHECK passes on NULL).
-- =============================================================

BEGIN;

ALTER TABLE loans ALTER COLUMN principal     DROP NOT NULL;
ALTER TABLE loans ALTER COLUMN interest_rate DROP NOT NULL;
ALTER TABLE loans ALTER COLUMN tenure        DROP NOT NULL;

-- Post-flight: confirm the three columns are now nullable.
DO $$
DECLARE
    not_nullable text;
BEGIN
    SELECT string_agg(column_name, ', ')
      INTO not_nullable
      FROM information_schema.columns
     WHERE table_name = 'loans'
       AND column_name IN ('principal', 'interest_rate', 'tenure')
       AND is_nullable = 'NO';
    IF not_nullable IS NOT NULL THEN
        RAISE EXCEPTION 'loans columns still NOT NULL after migration: %', not_nullable;
    END IF;
END
$$;

COMMIT;

-- =============================================================
-- Verify:
--   SELECT column_name, is_nullable FROM information_schema.columns
--    WHERE table_name='loans'
--      AND column_name IN ('principal','interest_rate','tenure');
--   -- all three is_nullable = YES
-- =============================================================
