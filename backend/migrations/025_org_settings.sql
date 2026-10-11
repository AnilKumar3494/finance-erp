-- =============================================================
-- Migration 025: org_settings — per-deployment organisation branding
-- Date: 2026-10-11
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- Each franchise runs its own stack and database, so the organisation name
-- shown on the login page, sidebar, receipts, statements and reports lives
-- here instead of in the frontend build. Single-row table (id is pinned to
-- 1). Deliberately NOT seeded: until a SUPER_ADMIN saves from Settings, the
-- API serves the ORG_DISPLAY_NAME / ORG_SHORT_NAME env defaults.

CREATE TABLE IF NOT EXISTS org_settings (
    id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    display_name VARCHAR(100) NOT NULL,
    short_name   VARCHAR(30)  NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by   UUID NULL REFERENCES users(id)
);
