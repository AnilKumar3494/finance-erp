-- =============================================================
-- Migration 024: loans — first_emi_date
-- Date: 2026-08-12
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- The date the first EMI falls due ("Due date" in the UI). Optional at
-- creation, captured up front so it survives to approval; required at
-- approval, where it anchors the whole repayment schedule (previously the
-- schedule was always derived from the approval date). NULL for legacy loans
-- and drafts that have not set it yet.

ALTER TABLE loans
    ADD COLUMN IF NOT EXISTS first_emi_date DATE;
