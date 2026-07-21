-- =============================================================
-- Migration 021: add transactions.ta_amount (Travelling Allowance)
-- Date: 2026-07-21
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- Why
-- ---
-- iFinance collects a small "TA" (Travelling Allowance) charge alongside some
-- EMI payments — a per-visit collection fee, almost always Rs.200, added by the
-- collector at the doorstep. In iFinance it lives in a separate `taHPReceipts`
-- stream tied to the same EMI receipt (emi_dl_id). It is NOT part of the loan
-- balance, the EMI schedule, or the "EMI Collection" total — it is separate
-- income collected on top of the EMI.
--
-- We model it as a column ON the EMI transaction (same collection event, mirrors
-- iFinance) rather than a new transaction_type: `amount` still drives cycle
-- allocation / balance, and `ta_amount` is summed separately in reports.
-- Defaults to 0; only receipts that carried a TA charge have a positive value.
-- =============================================================

BEGIN;

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS ta_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

-- TA can never be negative.
ALTER TABLE transactions
    DROP CONSTRAINT IF EXISTS ck_transactions_ta_amount_nonneg;
ALTER TABLE transactions
    ADD CONSTRAINT ck_transactions_ta_amount_nonneg CHECK (ta_amount >= 0);

-- Post-flight: confirm the column exists.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'transactions' AND column_name = 'ta_amount'
    ) THEN
        RAISE EXCEPTION 'transactions.ta_amount missing after migration';
    END IF;
END
$$;

COMMIT;

-- =============================================================
-- Verify:
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--    WHERE table_name='transactions' AND column_name='ta_amount';
--   -- numeric, 0
-- =============================================================
