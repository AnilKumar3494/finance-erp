-- =============================================================
-- Migration 016: add loans.hp_number (hire-purchase number)
-- Date: 2026-06-12
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- Why
-- ---
-- "HP No" is the customer-facing hire-purchase number carried over from the
-- legacy iFinanceBooks system (it encodes product + branch + serial, e.g.
-- "SAFTNK0401"). The new ERP shows it as the primary loan identifier across the
-- UI, while the internal loan_number (LMS-…) stays as the system id.
--
-- For now HP No is user-entered in the New Finance wizard (financials step); a
-- per-series auto-counter is planned later. The column is NULLABLE so the
-- draft-first wizard can create the loan before the number is entered, and is
-- UNIQUE when set — Postgres treats NULLs as distinct, so multiple unfinished
-- DRAFT rows with NULL hp_number do not collide. services/loan.approve_loan
-- rejects a DRAFT whose hp_number is NULL, so no ACTIVE loan lacks one.
-- =============================================================

BEGIN;

ALTER TABLE loans ADD COLUMN IF NOT EXISTS hp_number VARCHAR(30);

-- Unique when present; multiple NULLs allowed (DRAFTs not yet numbered).
-- A unique index doubles as the lookup/search index, so no separate index.
CREATE UNIQUE INDEX IF NOT EXISTS ix_loans_hp_number ON loans (hp_number);

-- Post-flight: confirm the column and unique index exist.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'loans' AND column_name = 'hp_number'
    ) THEN
        RAISE EXCEPTION 'loans.hp_number missing after migration';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE tablename = 'loans' AND indexname = 'ix_loans_hp_number'
    ) THEN
        RAISE EXCEPTION 'ix_loans_hp_number missing after migration';
    END IF;
END
$$;

COMMIT;

-- =============================================================
-- Verify:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name='loans' AND column_name='hp_number';
--   -- character varying, YES
--   SELECT indexname FROM pg_indexes
--    WHERE tablename='loans' AND indexname='ix_loans_hp_number';
-- =============================================================
