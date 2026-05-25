-- =============================================================
-- Migration 006: loan_closures.closed_by_id consistency
-- Date: 2026-05-21
-- =============================================================
-- The FK was declared ON DELETE SET NULL but the column was NOT NULL.
-- Hard-deleting a user with closures attached would fail at the constraint.
-- Drop the NOT NULL so the SET NULL behaviour is actually reachable.
-- (We prefer SET NULL over RESTRICT because users get hard-deleted in user
-- offboarding flows; we'd rather preserve the closure history with a NULL
-- actor than block user deletion.)
-- =============================================================

BEGIN;

ALTER TABLE loan_closures
    ALTER COLUMN closed_by_id DROP NOT NULL;

COMMIT;

-- Verify:
-- SELECT column_name, is_nullable FROM information_schema.columns
-- WHERE table_name='loan_closures' AND column_name='closed_by_id';
-- Expected: closed_by_id  YES
