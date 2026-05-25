-- =============================================================
-- Migration 003: Customer Hardening
-- Date: 2026-05-15
-- =============================================================
-- Covers audit items:
--   #4  Replace customers' full UNIQUE constraints (mobile / aadhaar / pan)
--       with PARTIAL unique indexes (WHERE is_deleted = false) so a value
--       can be re-onboarded after the previous holder is soft-deleted.
--       Brings customers in line with personnel/documents/transactions.
--   #18 Add `pincode` (6-char Indian PIN) to customers AND personnel
--       (personnel rows back guarantors & co-hirers).
--   #21 Add `idempotency_key` to customers + partial unique index, mirroring
--       transactions.idempotency_key, for safe POST retries.
--   #22 Drop the orphaned `set_updated_at()` trigger function. Its triggers
--       were already removed in migration 001 (B7); the function lingered
--       unused. `update_updated_at_column()` + its per-table triggers remain
--       the single source of truth for updated_at.
--
-- HOW TO RUN:
--   psql -U postgres -d <your_database> -f 003_customer_hardening.sql
--
-- SAFETY: Fully transactional. Re-runnable via IF [NOT] EXISTS guards.
--         If a duplicate mobile/aadhaar/pan exists among ACTIVE customers,
--         the partial-unique CREATE will fail — clean the data first.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- #4 — customers: full UNIQUE  ->  partial UNIQUE (active rows)
-- -------------------------------------------------------------
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_mobile_number_key;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_aadhaar_number_key;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_pan_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_mobile_active
    ON customers (mobile_number)
    WHERE (is_deleted = false);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_aadhaar_active
    ON customers (aadhaar_number)
    WHERE (is_deleted = false AND aadhaar_number IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_pan_active
    ON customers (pan_number)
    WHERE (is_deleted = false AND pan_number IS NOT NULL);

-- -------------------------------------------------------------
-- #18 — pincode on customers + personnel
-- -------------------------------------------------------------
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS pincode varchar(6) NULL;

ALTER TABLE personnel
    ADD COLUMN IF NOT EXISTS pincode varchar(6) NULL;

-- -------------------------------------------------------------
-- #21 — customers.idempotency_key + partial unique index
-- -------------------------------------------------------------
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS idempotency_key varchar(64) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_idempotency_key
    ON customers (idempotency_key)
    WHERE (idempotency_key IS NOT NULL);

-- -------------------------------------------------------------
-- #22 — drop orphaned duplicate updated_at trigger function
--       (its triggers were dropped in migration 001 part B7)
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS set_updated_at();

COMMIT;

-- -------------------------------------------------------------
-- VERIFICATION (run manually after COMMIT)
-- -------------------------------------------------------------
-- 1. Confirm partial unique indexes exist on customers:
--    SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'customers' AND indexname LIKE 'uq_customers_%';
--
-- 2. Confirm old constraints are gone:
--    SELECT conname FROM pg_constraint
--    WHERE conrelid = 'customers'::regclass AND contype = 'u';
--
-- 3. Confirm set_updated_at() is gone, update_updated_at_column() remains:
--    SELECT proname FROM pg_proc WHERE proname LIKE '%updated_at%';
-- =============================================================
