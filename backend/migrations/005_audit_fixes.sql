-- =============================================================
-- Migration 005: Audit Fixes (from the original loan/transaction review)
-- Date: 2026-05-21
-- =============================================================
-- Items addressed:
--   - Scope `transactions.idempotency_key` uniqueness to (loan_id, key)
--     so the same client-generated key can be safely reused across loans
--     (review item T4 — global unique allowed leaking another user's txn).
--
-- The `deleted_by_id` set-on-soft-delete fix and the RBAC tightening on
-- transaction endpoints are code-only changes (no DDL).
--
-- SAFETY: fully transactional, re-runnable via IF [NOT] EXISTS guards.
-- =============================================================

BEGIN;

-- Drop the global unique index on idempotency_key
DROP INDEX IF EXISTS uq_transactions_idempotency_key;

-- Replace with a scoped one (loan_id, idempotency_key) — partial so NULL keys
-- are still allowed
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_idempotency_key_per_loan
    ON transactions (loan_id, idempotency_key)
    WHERE (idempotency_key IS NOT NULL AND is_deleted = FALSE);

COMMIT;

-- =============================================================
-- VERIFICATION
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename = 'transactions' AND indexname LIKE 'uq_transactions_idempotency%';
-- Expected: uq_transactions_idempotency_key_per_loan (composite on loan_id + key)
-- =============================================================
