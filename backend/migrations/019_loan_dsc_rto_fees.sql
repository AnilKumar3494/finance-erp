-- =============================================================
-- Migration 019: loans — DSC fee & RTO fee
-- Date: 2026-07-18
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- Two more upfront charges on a finance, alongside processing_fee and
-- documentation_fee. Same semantics: they reduce the disbursed amount
-- (net_disbursed_amount), not the EMI or the interest.

ALTER TABLE loans
    ADD COLUMN IF NOT EXISTS dsc_fee NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS rto_fee NUMERIC(15, 2) NOT NULL DEFAULT 0.00;
