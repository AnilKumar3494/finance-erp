-- =============================================================
-- Migration 022: Make customer mobile numbers reusable
-- Date: 2026-07-28
-- =============================================================
-- Business change requested by the client: one phone number may now belong
-- to more than one active customer. In practice a household shares a single
-- handset — a father, son and brother financing separate vehicles all give
-- the same number — and the old constraint forced staff to invent fake
-- numbers to get past the form, which corrupted the contact data outright.
--
-- Migration 003 (#4) replaced the full UNIQUE constraint on
-- customers.mobile_number with the PARTIAL unique index
-- `uq_customers_mobile_active` (WHERE is_deleted = false). That index is what
-- currently rejects a reused number with a 409. This migration drops it and
-- puts a NON-unique index in its place, so lookups by mobile stay fast
-- (customer search filters on mobile_number with ILIKE, and the column is
-- declared index=True on the model).
--
-- SCOPE: mobile_number ONLY. The partial unique indexes on aadhaar_number
-- (`uq_customers_aadhaar_active`) and pan_number (`uq_customers_pan_active`)
-- are deliberately LEFT IN PLACE — those are genuine government identifiers
-- and a duplicate there is a data-entry error, not a shared handset.
-- personnel.mobile_number keeps its own UNIQUE constraint from migration 001;
-- this change was not requested for guarantors / co-hirers.
--
-- The UI warns ("this number is already registered to <name>") but allows the
-- user to proceed, so duplicates are now expected rather than exceptional.
--
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- SAFETY: Fully transactional and re-runnable via IF [NOT] EXISTS guards.
--         This RELAXES a constraint, so it cannot fail on existing data.
--         Reversing it later is NOT automatic: once duplicates exist, the
--         unique index cannot be recreated until they are cleaned up.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- Drop the partial UNIQUE index that blocks reuse
-- -------------------------------------------------------------
DROP INDEX IF EXISTS uq_customers_mobile_active;

-- -------------------------------------------------------------
-- Keep a plain (non-unique) index so search / lookup by mobile
-- does not regress to a sequential scan.
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_customers_mobile_active
    ON customers (mobile_number)
    WHERE (is_deleted = false);

COMMIT;

-- -------------------------------------------------------------
-- VERIFICATION (run manually after COMMIT)
-- -------------------------------------------------------------
-- 1. Unique index gone, plain index present:
--    SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'customers' AND indexname LIKE '%mobile%';
--    -- expect idx_customers_mobile_active, NOT uq_customers_mobile_active
--
-- 2. Aadhaar/PAN uniqueness deliberately retained:
--    SELECT indexname FROM pg_indexes
--    WHERE tablename = 'customers' AND indexname LIKE 'uq_customers_%';
--    -- expect uq_customers_aadhaar_active, uq_customers_pan_active,
--    --        uq_customers_idempotency_key
--
-- 3. A duplicate active mobile now inserts without error.
-- =============================================================
