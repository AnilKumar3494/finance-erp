-- =============================================================
-- Migration 017: WhatsApp EMI reminders
-- Date: 2026-06-16
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- Why
-- ---
-- Adds the schema for automated WhatsApp reminders sent ahead of each EMI
-- due date (default 7 days and 3 days before). Four pieces:
--
--   1. customers.whatsapp_reminders_enabled — per-customer opt-out/consent.
--      Defaults true; staff flip it off for customers who decline, and the
--      job additionally skips customers whose remarks carry a "[REVIEW…]"
--      placeholder-phone flag (migrated, unverified numbers).
--   2. loans.reminders_enabled — per-finance toggle (mute one loan).
--   3. whatsapp_settings — a singleton row holding the runtime on/off, the
--      approved template name/language + an editable preview body, the
--      reminder offsets, and the send time. The admin UI edits this row;
--      no redeploy needed to pause reminders or tweak copy.
--   4. whatsapp_reminder_log — one row per send attempt. Doubles as the
--      idempotency ledger: a partial unique index on (due_cycle_id,
--      offset_days) for already-sent rows means a cycle never gets the same
--      reminder twice, even if the job re-runs.
-- =============================================================

BEGIN;

-- 1. Per-customer opt-out / consent ---------------------------------------
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS whatsapp_reminders_enabled BOOLEAN NOT NULL DEFAULT true;

-- 2. Per-finance toggle ---------------------------------------------------
ALTER TABLE loans
    ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT true;

-- 3. Settings singleton ---------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_settings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- one-row guard: only a single settings row may ever exist
    singleton             SMALLINT NOT NULL DEFAULT 1 UNIQUE CHECK (singleton = 1),
    -- runtime master switch the admin UI toggles
    reminders_enabled     BOOLEAN NOT NULL DEFAULT false,
    -- the Meta-approved template this maps to + an editable preview copy.
    -- Changing the WORDING requires re-submitting the template to Meta;
    -- the preview is for the admin UI + audit, not what is sent verbatim.
    template_name         TEXT NOT NULL DEFAULT 'emi_reminder',
    template_language     TEXT NOT NULL DEFAULT 'en',
    template_body_preview TEXT NOT NULL DEFAULT
        'Namaste {{1}}, your EMI of Rs {{2}} for vehicle finance {{4}} is due on {{3}}. Please pay on time to avoid issues. - Sri Adithya Finance',
    -- days-before-due-date to send (default: a week out, then 3 days out)
    reminder_offsets_days JSONB NOT NULL DEFAULT '[7, 3]'::jsonb,
    send_hour             SMALLINT NOT NULL DEFAULT 9  CHECK (send_hour BETWEEN 0 AND 23),
    send_minute           SMALLINT NOT NULL DEFAULT 0  CHECK (send_minute BETWEEN 0 AND 59),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_id         UUID REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE whatsapp_settings IS
    'Singleton config for WhatsApp EMI reminders. Edited from the admin UI.';

-- Seed the single row (idempotent).
INSERT INTO whatsapp_settings (singleton) VALUES (1)
ON CONFLICT (singleton) DO NOTHING;

-- 4. Send log + idempotency ledger ----------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_reminder_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    due_cycle_id        UUID NOT NULL REFERENCES due_cycles(id) ON DELETE CASCADE,
    loan_id             UUID NOT NULL REFERENCES loans(id)      ON DELETE CASCADE,
    customer_id         UUID NOT NULL REFERENCES customers(id)  ON DELETE CASCADE,
    offset_days         SMALLINT NOT NULL,
    phone               VARCHAR(20),
    -- SENT | FAILED | SKIPPED | DRY_RUN
    status              VARCHAR(10) NOT NULL
                          CHECK (status IN ('SENT', 'FAILED', 'SKIPPED', 'DRY_RUN')),
    provider_message_id TEXT,
    error               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: at most one successful (or dry-run) reminder per cycle+offset.
-- FAILED/SKIPPED rows are NOT covered, so a transient failure can be retried
-- on the next run.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_reminder_cycle_offset
    ON whatsapp_reminder_log (due_cycle_id, offset_days)
    WHERE status IN ('SENT', 'DRY_RUN');

-- Lookups for the admin log view.
CREATE INDEX IF NOT EXISTS ix_whatsapp_reminder_created_at
    ON whatsapp_reminder_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_whatsapp_reminder_customer
    ON whatsapp_reminder_log (customer_id);

-- Post-flight checks ------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'customers' AND column_name = 'whatsapp_reminders_enabled'
    ) THEN
        RAISE EXCEPTION 'customers.whatsapp_reminders_enabled missing after migration';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'loans' AND column_name = 'reminders_enabled'
    ) THEN
        RAISE EXCEPTION 'loans.reminders_enabled missing after migration';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM whatsapp_settings WHERE singleton = 1) THEN
        RAISE EXCEPTION 'whatsapp_settings seed row missing after migration';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE tablename = 'whatsapp_reminder_log'
           AND indexname = 'uq_whatsapp_reminder_cycle_offset'
    ) THEN
        RAISE EXCEPTION 'uq_whatsapp_reminder_cycle_offset missing after migration';
    END IF;
END
$$;

COMMIT;

-- =============================================================
-- Verify:
--   SELECT reminders_enabled, template_name, reminder_offsets_days
--     FROM whatsapp_settings;
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='customers' AND column_name='whatsapp_reminders_enabled';
-- =============================================================
