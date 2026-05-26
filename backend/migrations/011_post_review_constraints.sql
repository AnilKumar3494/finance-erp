-- =============================================================
-- Migration 011: post-review constraint tightening
-- Date: 2026-05-26
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- Single new constraint surfaced by the cross-module CodeRabbit pass:
--
--   users.failed_login_attempts >= 0
--     The column defaults to 0 and is NOT NULL but accepted negative
--     writes. The lockout math (attempts >= LOGIN_MAX_FAILED_ATTEMPTS)
--     would be bypassed by any direct update that drove the counter
--     below zero. CHECK is added defensively; the application path
--     already increments from 0 only.
--
-- The other items CodeRabbit flagged against migration 004
-- (closed_by_id NOT NULL vs ON DELETE SET NULL) were already fixed by
-- migration 006 on the live DB; no further DDL is needed here.
--
-- Pre-flight: fail loudly if any pre-existing row violates the new
-- invariant. There shouldn't be any (the application never decrements)
-- but raw SQL or a botched test fixture could have left a stray.
-- =============================================================

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM users WHERE failed_login_attempts < 0) THEN
        RAISE EXCEPTION
            'users has rows with failed_login_attempts < 0 — clean before tightening';
    END IF;
END
$$;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS ck_users_failed_login_attempts_nonneg;

ALTER TABLE users
    ADD CONSTRAINT ck_users_failed_login_attempts_nonneg
    CHECK (failed_login_attempts >= 0);

COMMIT;

-- =============================================================
-- Verify:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid='users'::regclass AND conname LIKE 'ck_users_%';
--   -- expected: ck_users_failed_login_attempts_nonneg
-- =============================================================
