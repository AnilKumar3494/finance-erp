-- =============================================================
-- Migration 002: Auth Hardening
-- Date: 2026-05-14
-- =============================================================
-- Adds login-security columns to `users`:
--   - last_login_at         : timestamp of last successful login
--   - failed_login_attempts : counter, reset to 0 on success
--   - locked_until          : when set + in future, account is locked
--
-- The `audit_logs` table already exists from initial schema, so this
-- migration only touches `users`. Re-running is safe via IF NOT EXISTS.
--
-- HOW TO RUN:
--   psql -U postgres -d <your_database> -f 002_auth_hardening.sql
-- =============================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_login_at         timestamptz NULL,
    ADD COLUMN IF NOT EXISTS failed_login_attempts integer     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until          timestamptz NULL;

-- Helpful index for any future "currently locked users" admin view.
CREATE INDEX IF NOT EXISTS idx_users_locked_until
    ON users (locked_until)
    WHERE locked_until IS NOT NULL;

COMMIT;
