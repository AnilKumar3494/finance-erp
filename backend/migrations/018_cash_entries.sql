-- =============================================================
-- Migration 018: cash_entries — capital & expense ledger
-- Date: 2026-07-05
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- Why
-- ---
-- The Day Report's rolling position tracked only loan money (collections in,
-- disbursements out), so it sat deeply negative — the business's capital
-- infusions and running expenses lived outside the system. cash_entries
-- records those non-loan cash movements so the day book balances like a
-- real cash book (mirrors the legacy iFinanceBooks Capitals/Expenses
-- modules, collapsed into one simple ledger):
--
--   CAPITAL_IN    owner/partner money put into the business   (money in)
--   OTHER_INCOME  non-EMI income (fees, scrap sales, misc)    (money in)
--   EXPENSE       running costs (rent, salaries, stationery)  (money out)
--   CAPITAL_OUT   owner withdrawals                           (money out)
--
-- entry_date is a DATE (business date, like transactions.effective_payment
-- _date) so reports bucket identically. category is free text — the expense
-- taxonomy can grow without schema changes, same rationale as
-- customers.branch_point.
-- =============================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_entry_type') THEN
        CREATE TYPE cash_entry_type AS ENUM
            ('CAPITAL_IN', 'OTHER_INCOME', 'EXPENSE', 'CAPITAL_OUT');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS cash_entries (
    id                UUID             NOT NULL DEFAULT gen_random_uuid(),
    entry_type        cash_entry_type  NOT NULL,
    entry_date        DATE             NOT NULL,
    amount            NUMERIC(15,2)    NOT NULL,
    category          VARCHAR(100),
    notes             TEXT,

    -- Audit base
    is_deleted        BOOLEAN          NOT NULL DEFAULT FALSE,
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id     UUID,
    updated_by_id     UUID,
    deleted_by_id     UUID,

    CONSTRAINT cash_entries_pkey              PRIMARY KEY (id),
    CONSTRAINT ck_cash_entries_amount_positive CHECK (amount > 0),
    CONSTRAINT check_soft_delete_cash_entries CHECK (
        (is_deleted = FALSE AND deleted_at IS NULL) OR
        (is_deleted = TRUE  AND deleted_at IS NOT NULL)
    ),
    CONSTRAINT cash_entries_created_by_fkey   FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT cash_entries_updated_by_fkey   FOREIGN KEY (updated_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT cash_entries_deleted_by_fkey   FOREIGN KEY (deleted_by_id) REFERENCES users(id) ON DELETE SET NULL
);

-- The day report / capital-expenses screens always filter on date (and often
-- type) over non-deleted rows.
CREATE INDEX IF NOT EXISTS idx_cash_entries_date
    ON cash_entries (entry_date)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_cash_entries_type_date
    ON cash_entries (entry_type, entry_date)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_cash_entries_is_deleted
    ON cash_entries (is_deleted);

CREATE INDEX IF NOT EXISTS idx_cash_entries_created_by
    ON cash_entries (created_by_id);

-- Post-flight: confirm the table exists.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'cash_entries'
    ) THEN
        RAISE EXCEPTION 'cash_entries missing after migration';
    END IF;
END
$$;

COMMIT;

-- =============================================================
-- Verify:
--   SELECT count(*) FROM cash_entries;                       -- 0
--   SELECT unnest(enum_range(NULL::cash_entry_type));        -- 4 values
-- =============================================================
