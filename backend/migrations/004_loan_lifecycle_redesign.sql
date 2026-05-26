-- =============================================================
-- Migration 004: Loan Lifecycle Redesign
-- Date: 2026-05-20
-- =============================================================
-- Implements the EMI-cycle + daily-penalty + admin-closure model
-- agreed with the client.
--
-- Scope:
--   - Per-month due-cycle tracking (due_cycles table)
--   - Daily late-payment penalty (Reading B: month-length aware),
--     capped at 100% of the late amount (penalty_events table)
--   - Admin-controlled loan closure with closure fields & NOC
--     (loan_closures table; auto-close REMOVED in app code, step 7)
--   - Bad-debt proposal workflow (bad_debt_proposals table)
--   - New loan_status values: DRAFT, AWAITING_CLOSURE,
--     BAD_DEBT_PROPOSED
--   - Per-loan penalty_rate (default 36%/month, admin-editable)
--   - approval_date + due_day_of_month on loans
--   - effective_payment_date + punctuality_status + due_cycle_id
--     on transactions
--
-- SECTIONS:
--   PART A — Enum changes (outside transaction)
--   PART B — Schema + data changes (transactional)
--     B1. Add columns to existing tables
--     B2. Backfill existing rows
--     B3. Add NOT NULL where required
--     B4. Create due_cycles
--     B5. Create penalty_events
--     B6. Create loan_closures
--     B7. Create bad_debt_proposals
--     B8. Generate due_cycles for existing ACTIVE loans
--     B9. Indexes + triggers
--   PART C — Verification queries (commented; run manually)
--
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- (Direct `psql -f` works but bypasses the tracker.)
--
-- NOTES:
--   - ALTER TYPE ADD VALUE cannot be rolled back; it sits in PART A.
--   - PART B is fully transactional and re-runnable via IF [NOT]
--     EXISTS guards.
--   - CodeRabbit flagged `closed_by_id NOT NULL` against `ON DELETE
--     SET NULL` on loan_closures (line ~362 below). That conflict is
--     genuine in THIS file but was resolved by migration 006
--     (006_loan_closure_fk_fix.sql), which drops the NOT NULL. The
--     live DB has the relaxed shape; do not "fix" 004 in place —
--     altering an already-applied migration would create drift.
--   - PG handles month-overflow on date+interval by falling back to
--     the last day of the target month (so a loan approved on the
--     31st gets 28th/29th in Feb), which matches the agreed
--     last-day-of-month rule.
-- =============================================================


-- =============================================================
-- PART A: ENUM CHANGES (outside transaction)
-- =============================================================

-- Extend loan_status with the new lifecycle states
ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'AWAITING_CLOSURE';
ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'BAD_DEBT_PROPOSED';

-- New enum: per-transaction admin classification for on-time vs late
DO $$ BEGIN
    CREATE TYPE punctuality_status AS ENUM (
        'AWAITING_REVIEW',  -- default; not yet classified
        'PAID_ON_TIME',     -- admin says no penalty; only allowed when cycle shortfall = 0
        'LATE_PAYMENT'      -- admin says late; penalty applies (date mandatory)
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- New enum: aggregate state of a due cycle (drives penalty + closure logic)
DO $$ BEGIN
    CREATE TYPE cycle_status AS ENUM (
        'UPCOMING',         -- due date in the future, no activity yet
        'AWAITING_REVIEW',  -- past due with shortfall; admin must classify
        'PAID_ON_TIME',     -- cycle fully met by due date
        'LATE_PAYMENT',     -- shortfall existed; admin classified late; penalty applied
        'MISSED_CAPPED'     -- penalty hit cap (100% of late amt); loan moved to BAD_DEBT_PROPOSED
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- New enum: how a loan was closed
DO $$ BEGIN
    CREATE TYPE closure_type AS ENUM (
        'NORMAL_TENURE',         -- fully repaid over the original schedule
        'EARLY_FORECLOSURE',     -- customer paid full outstanding before tenure end
        'NEGOTIATED_SETTLEMENT', -- partial recovery agreed with customer
        'WRITE_OFF'              -- bad debt approved, no recovery
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- New enum: lifecycle of a bad-debt proposal
DO $$ BEGIN
    CREATE TYPE bad_debt_proposal_status AS ENUM (
        'PROPOSED',
        'APPROVED',
        'REJECTED'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================
-- PART B: SCHEMA + DATA CHANGES (transactional)
-- =============================================================

BEGIN;

-- -----------------------------------------------------------
-- B1. ADD COLUMNS TO EXISTING TABLES
-- -----------------------------------------------------------

-- loans: penalty rate, approval date, due day-of-month
ALTER TABLE loans
    ADD COLUMN IF NOT EXISTS penalty_rate       NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS approval_date      DATE,
    ADD COLUMN IF NOT EXISTS due_day_of_month   SMALLINT;

-- transactions: effective payment date, punctuality, cycle allocation
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS effective_payment_date  DATE,
    ADD COLUMN IF NOT EXISTS punctuality_status      punctuality_status,
    ADD COLUMN IF NOT EXISTS due_cycle_id            UUID;


-- -----------------------------------------------------------
-- B2. BACKFILL EXISTING ROWS
-- -----------------------------------------------------------

-- Default penalty rate for every existing loan
UPDATE loans
SET penalty_rate = 36.00
WHERE penalty_rate IS NULL;

-- Treat the original creation date as the approval date for legacy
-- loans, and derive the due day-of-month from it.
UPDATE loans
SET approval_date    = created_at::date,
    due_day_of_month = EXTRACT(DAY FROM created_at)::smallint
WHERE approval_date IS NULL;

-- Cap due_day_of_month at 28 only if the source day was 29-31 AND
-- the resulting due_date calculation is expected to flex; we keep
-- the original day, because PG's date+interval gives last-day-of-
-- month behaviour automatically. So no cap needed here.

-- transactions: effective_payment_date defaults to created_at::date
UPDATE transactions
SET effective_payment_date = created_at::date
WHERE effective_payment_date IS NULL;

-- transactions: map old status to a sensible punctuality default
--   SUCCESS  -> PAID_ON_TIME (admin already approved; treat as good)
--   PENDING  -> AWAITING_REVIEW
--   FAILED   -> AWAITING_REVIEW (failed txns are excluded from accounting anyway)
UPDATE transactions
SET punctuality_status = CASE
    WHEN status = 'SUCCESS' THEN 'PAID_ON_TIME'::punctuality_status
    ELSE 'AWAITING_REVIEW'::punctuality_status
END
WHERE punctuality_status IS NULL;


-- -----------------------------------------------------------
-- B3. ADD NOT NULL + CHECK CONSTRAINTS
-- -----------------------------------------------------------

-- loans: penalty_rate non-null, positive; due_day_of_month 1..31
ALTER TABLE loans
    ALTER COLUMN penalty_rate     SET NOT NULL,
    ALTER COLUMN penalty_rate     SET DEFAULT 36.00;

ALTER TABLE loans
    ADD CONSTRAINT loans_penalty_rate_check
        CHECK (penalty_rate >= 0 AND penalty_rate <= 1000);

ALTER TABLE loans
    ADD CONSTRAINT loans_due_day_of_month_check
        CHECK (due_day_of_month IS NULL OR (due_day_of_month BETWEEN 1 AND 31));

-- approval_date may stay nullable: a DRAFT loan hasn't been approved.

-- transactions: effective_payment_date + punctuality_status non-null
ALTER TABLE transactions
    ALTER COLUMN effective_payment_date SET NOT NULL,
    ALTER COLUMN punctuality_status     SET NOT NULL,
    ALTER COLUMN punctuality_status     SET DEFAULT 'AWAITING_REVIEW';


-- -----------------------------------------------------------
-- B4. CREATE due_cycles TABLE
-- One row per (loan, cycle_number). Generated at loan approval.
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS due_cycles (
    id                       UUID            NOT NULL DEFAULT gen_random_uuid(),
    loan_id                  UUID            NOT NULL,
    cycle_number             SMALLINT        NOT NULL,         -- 1..tenure
    due_date                 DATE            NOT NULL,

    -- Money columns (all NUMERIC(15,2))
    base_emi                 NUMERIC(15,2)   NOT NULL,         -- total_payable / tenure (last cycle absorbs remainder)
    addon_from_penalties     NUMERIC(15,2)   NOT NULL DEFAULT 0.00,
    total_due                NUMERIC(15,2)   NOT NULL,         -- base_emi + addon_from_penalties (cached for queries)
    total_received           NUMERIC(15,2)   NOT NULL DEFAULT 0.00,
    penalty_amount           NUMERIC(15,2)   NOT NULL DEFAULT 0.00,  -- cumulative penalty applied to this cycle

    -- Classification
    cycle_status             cycle_status    NOT NULL DEFAULT 'UPCOMING',
    classified_as_of_date    DATE,                              -- date admin used for the penalty calc on this cycle
    classified_by_id         UUID,
    classified_at            TIMESTAMPTZ,
    classification_note      TEXT,

    -- Audit base
    is_deleted               BOOLEAN         NOT NULL DEFAULT FALSE,
    deleted_at               TIMESTAMPTZ,
    created_at               TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id            UUID,
    updated_by_id            UUID,
    deleted_by_id            UUID,

    CONSTRAINT due_cycles_pkey                  PRIMARY KEY (id),
    CONSTRAINT due_cycles_base_emi_check        CHECK (base_emi >= 0),
    CONSTRAINT due_cycles_addon_check           CHECK (addon_from_penalties >= 0),
    CONSTRAINT due_cycles_total_due_check       CHECK (total_due >= 0),
    CONSTRAINT due_cycles_total_received_check  CHECK (total_received >= 0),
    CONSTRAINT due_cycles_penalty_amount_check  CHECK (penalty_amount >= 0),
    CONSTRAINT due_cycles_cycle_number_check    CHECK (cycle_number >= 1),
    CONSTRAINT check_soft_delete_due_cycles     CHECK (
        (is_deleted = FALSE AND deleted_at IS NULL) OR
        (is_deleted = TRUE  AND deleted_at IS NOT NULL)
    ),
    CONSTRAINT due_cycles_loan_id_fkey          FOREIGN KEY (loan_id)          REFERENCES loans(id) ON DELETE RESTRICT,
    CONSTRAINT due_cycles_classified_by_fkey    FOREIGN KEY (classified_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT due_cycles_created_by_fkey       FOREIGN KEY (created_by_id)    REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT due_cycles_updated_by_fkey       FOREIGN KEY (updated_by_id)    REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT due_cycles_deleted_by_fkey       FOREIGN KEY (deleted_by_id)    REFERENCES users(id) ON DELETE SET NULL
);

-- One active cycle per (loan, cycle_number)
CREATE UNIQUE INDEX IF NOT EXISTS uq_due_cycles_loan_cycle_active
    ON due_cycles (loan_id, cycle_number)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_due_cycles_loan
    ON due_cycles (loan_id)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_due_cycles_due_date
    ON due_cycles (due_date)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_due_cycles_status
    ON due_cycles (cycle_status)
    WHERE is_deleted = FALSE;

CREATE TRIGGER trigger_update_due_cycles_updated_at
    BEFORE UPDATE ON due_cycles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- transactions.due_cycle_id FK + index (added after the table exists)
ALTER TABLE transactions
    ADD CONSTRAINT transactions_due_cycle_id_fkey
        FOREIGN KEY (due_cycle_id) REFERENCES due_cycles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_due_cycle
    ON transactions (due_cycle_id)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_transactions_punctuality
    ON transactions (punctuality_status)
    WHERE is_deleted = FALSE;


-- -----------------------------------------------------------
-- B5. CREATE penalty_events TABLE
-- Immutable audit log of every penalty applied.
-- A reclassification supersedes (does not modify) earlier rows.
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS penalty_events (
    id                          UUID           NOT NULL DEFAULT gen_random_uuid(),
    due_cycle_id                UUID           NOT NULL,
    loan_id                     UUID           NOT NULL,         -- denormalised for fast filters

    -- Inputs at the time of calc
    late_amount                 NUMERIC(15,2)  NOT NULL,         -- the shortfall the penalty was based on
    days_late                   INTEGER        NOT NULL,
    days_in_due_month           SMALLINT       NOT NULL,         -- 28/29/30/31 - depends on due_date's month
    penalty_rate_snapshot       NUMERIC(5,2)   NOT NULL,         -- loan.penalty_rate AT the time

    -- Computed outputs
    penalty_amount              NUMERIC(15,2)  NOT NULL,         -- capped at late_amount
    cap_hit                     BOOLEAN        NOT NULL DEFAULT FALSE,
    spread_per_month            NUMERIC(15,2)  NOT NULL,         -- (shortfall + penalty) / remaining_months
    remaining_months_at_calc    SMALLINT       NOT NULL,

    -- Supersession (for reclassification audit chain)
    superseded_by_id            UUID,                            -- nullable FK back to penalty_events.id

    -- Who/when
    applied_by_id               UUID,
    classification_note         TEXT,
    created_at                  TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT penalty_events_pkey              PRIMARY KEY (id),
    CONSTRAINT penalty_events_late_amount_check CHECK (late_amount >= 0),
    CONSTRAINT penalty_events_days_late_check   CHECK (days_late >= 0),
    CONSTRAINT penalty_events_days_in_month_chk CHECK (days_in_due_month BETWEEN 28 AND 31),
    CONSTRAINT penalty_events_penalty_check     CHECK (penalty_amount >= 0 AND penalty_amount <= late_amount),
    CONSTRAINT penalty_events_remaining_check   CHECK (remaining_months_at_calc >= 0),

    CONSTRAINT penalty_events_cycle_fkey        FOREIGN KEY (due_cycle_id)     REFERENCES due_cycles(id)     ON DELETE RESTRICT,
    CONSTRAINT penalty_events_loan_fkey         FOREIGN KEY (loan_id)          REFERENCES loans(id)          ON DELETE RESTRICT,
    CONSTRAINT penalty_events_superseded_fkey   FOREIGN KEY (superseded_by_id) REFERENCES penalty_events(id) ON DELETE SET NULL,
    CONSTRAINT penalty_events_applied_by_fkey   FOREIGN KEY (applied_by_id)    REFERENCES users(id)          ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_penalty_events_loan
    ON penalty_events (loan_id);

CREATE INDEX IF NOT EXISTS idx_penalty_events_cycle
    ON penalty_events (due_cycle_id);

CREATE INDEX IF NOT EXISTS idx_penalty_events_active
    ON penalty_events (due_cycle_id)
    WHERE superseded_by_id IS NULL;


-- -----------------------------------------------------------
-- B6. CREATE loan_closures TABLE
-- Captures every closure attempt. One ACTIVE row per loan; if a
-- super-admin reverses a closure, the old row stays for audit.
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS loan_closures (
    id                          UUID           NOT NULL DEFAULT gen_random_uuid(),
    loan_id                     UUID           NOT NULL,

    closure_type                closure_type   NOT NULL,
    closing_charges             NUMERIC(15,2)  NOT NULL DEFAULT 0.00,
    charge_waived               BOOLEAN        NOT NULL DEFAULT FALSE,
    waiver_reason               TEXT,
    final_settlement_amount     NUMERIC(15,2)  NOT NULL,         -- actually collected at closure
    outstanding_at_closure      NUMERIC(15,2)  NOT NULL,         -- 0 for normal; > 0 for settlement/write-off
    amount_written_off          NUMERIC(15,2)  NOT NULL DEFAULT 0.00,
    refund_due_to_customer      NUMERIC(15,2)  NOT NULL DEFAULT 0.00,
    refund_status               VARCHAR(30),                     -- e.g., PENDING, PAID, NOT_APPLICABLE

    closure_date                DATE           NOT NULL,
    noc_issued                  BOOLEAN        NOT NULL DEFAULT FALSE,
    noc_reference               VARCHAR(100),
    closure_remarks             TEXT,
    supporting_document_id      UUID,                            -- optional FK to documents

    closed_by_id                UUID           NOT NULL,
    superseded_by_id            UUID,                            -- nullable FK back to loan_closures.id

    is_deleted                  BOOLEAN        NOT NULL DEFAULT FALSE,
    deleted_at                  TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id               UUID,
    updated_by_id               UUID,
    deleted_by_id               UUID,

    CONSTRAINT loan_closures_pkey                       PRIMARY KEY (id),
    CONSTRAINT loan_closures_closing_charges_check      CHECK (closing_charges >= 0),
    CONSTRAINT loan_closures_final_settlement_check     CHECK (final_settlement_amount >= 0),
    CONSTRAINT loan_closures_outstanding_check          CHECK (outstanding_at_closure >= 0),
    CONSTRAINT loan_closures_written_off_check          CHECK (amount_written_off >= 0),
    CONSTRAINT loan_closures_refund_check               CHECK (refund_due_to_customer >= 0),
    CONSTRAINT check_soft_delete_loan_closures          CHECK (
        (is_deleted = FALSE AND deleted_at IS NULL) OR
        (is_deleted = TRUE  AND deleted_at IS NOT NULL)
    ),

    CONSTRAINT loan_closures_loan_fkey         FOREIGN KEY (loan_id)                REFERENCES loans(id)         ON DELETE RESTRICT,
    CONSTRAINT loan_closures_doc_fkey          FOREIGN KEY (supporting_document_id) REFERENCES documents(id)     ON DELETE SET NULL,
    CONSTRAINT loan_closures_closed_by_fkey    FOREIGN KEY (closed_by_id)           REFERENCES users(id)         ON DELETE SET NULL,
    CONSTRAINT loan_closures_superseded_fkey   FOREIGN KEY (superseded_by_id)       REFERENCES loan_closures(id) ON DELETE SET NULL,
    CONSTRAINT loan_closures_created_by_fkey   FOREIGN KEY (created_by_id)          REFERENCES users(id)         ON DELETE SET NULL,
    CONSTRAINT loan_closures_updated_by_fkey   FOREIGN KEY (updated_by_id)          REFERENCES users(id)         ON DELETE SET NULL,
    CONSTRAINT loan_closures_deleted_by_fkey   FOREIGN KEY (deleted_by_id)          REFERENCES users(id)         ON DELETE SET NULL
);

-- One ACTIVE (non-superseded) closure per loan
CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_closures_loan_active
    ON loan_closures (loan_id)
    WHERE is_deleted = FALSE AND superseded_by_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_loan_closures_loan
    ON loan_closures (loan_id)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_loan_closures_date
    ON loan_closures (closure_date)
    WHERE is_deleted = FALSE;

CREATE TRIGGER trigger_update_loan_closures_updated_at
    BEFORE UPDATE ON loan_closures
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------
-- B7. CREATE bad_debt_proposals TABLE
-- Tracks the EMPLOYEE-propose / ADMIN-approve workflow + the
-- auto-proposal when penalty hits cap.
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS bad_debt_proposals (
    id                  UUID                       NOT NULL DEFAULT gen_random_uuid(),
    loan_id             UUID                       NOT NULL,
    status              bad_debt_proposal_status   NOT NULL DEFAULT 'PROPOSED',

    proposed_reason     TEXT                       NOT NULL,
    proposed_by_id      UUID,                                  -- NULL means system auto-proposed
    proposed_at         TIMESTAMPTZ                NOT NULL DEFAULT CURRENT_TIMESTAMP,
    auto_proposed       BOOLEAN                    NOT NULL DEFAULT FALSE,

    reviewed_by_id      UUID,                                  -- admin/super-admin who approved/rejected
    reviewed_at         TIMESTAMPTZ,
    review_notes        TEXT,

    is_deleted          BOOLEAN                    NOT NULL DEFAULT FALSE,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ                NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ                NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id       UUID,
    updated_by_id       UUID,
    deleted_by_id       UUID,

    CONSTRAINT bad_debt_proposals_pkey                  PRIMARY KEY (id),
    CONSTRAINT check_soft_delete_bad_debt_proposals     CHECK (
        (is_deleted = FALSE AND deleted_at IS NULL) OR
        (is_deleted = TRUE  AND deleted_at IS NOT NULL)
    ),
    CONSTRAINT bad_debt_proposals_loan_fkey         FOREIGN KEY (loan_id)         REFERENCES loans(id) ON DELETE RESTRICT,
    CONSTRAINT bad_debt_proposals_proposed_by_fkey  FOREIGN KEY (proposed_by_id)  REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT bad_debt_proposals_reviewed_by_fkey  FOREIGN KEY (reviewed_by_id)  REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT bad_debt_proposals_created_by_fkey   FOREIGN KEY (created_by_id)   REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT bad_debt_proposals_updated_by_fkey   FOREIGN KEY (updated_by_id)   REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT bad_debt_proposals_deleted_by_fkey   FOREIGN KEY (deleted_by_id)   REFERENCES users(id) ON DELETE SET NULL
);

-- At most ONE proposal in PROPOSED state per loan (prevent duplicate alerts)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bad_debt_proposals_open
    ON bad_debt_proposals (loan_id)
    WHERE status = 'PROPOSED' AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_bad_debt_proposals_loan
    ON bad_debt_proposals (loan_id)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_bad_debt_proposals_status
    ON bad_debt_proposals (status)
    WHERE is_deleted = FALSE;

CREATE TRIGGER trigger_update_bad_debt_proposals_updated_at
    BEFORE UPDATE ON bad_debt_proposals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------
-- B8. GENERATE due_cycles FOR EXISTING ACTIVE LOANS
-- Backfill: each ACTIVE non-deleted loan gets `tenure` cycles
-- using the EMI formula:
--   monthly_interest  = round((principal * rate / 100) / 12, 2)
--   total_payable     = principal + (monthly_interest * tenure)
--   regular_emi       = round(total_payable / tenure, 2)
--   final_emi         = total_payable - (regular_emi * (tenure - 1))
-- Due dates use approval_date + N months (PG handles the
-- last-day-of-month fallback automatically).
-- Transactions' due_cycle_id is intentionally NOT backfilled —
-- admin will reclassify legacy transactions via the new UI.
-- -----------------------------------------------------------

DO $$
DECLARE
    loan_rec          RECORD;
    cycle_num         SMALLINT;
    cycle_due_date    DATE;
    monthly_interest  NUMERIC(15,2);
    total_payable     NUMERIC(15,2);
    regular_emi       NUMERIC(15,2);
    final_emi         NUMERIC(15,2);
    this_emi          NUMERIC(15,2);
BEGIN
    FOR loan_rec IN
        SELECT id, principal, interest_rate, tenure, approval_date
        FROM loans
        WHERE status = 'ACTIVE'
          AND is_deleted = FALSE
          AND id NOT IN (SELECT DISTINCT loan_id FROM due_cycles WHERE is_deleted = FALSE)
    LOOP
        monthly_interest := ROUND((loan_rec.principal * loan_rec.interest_rate / 100) / 12, 2);
        total_payable    := loan_rec.principal + (monthly_interest * loan_rec.tenure);
        regular_emi      := ROUND(total_payable / loan_rec.tenure, 2);
        final_emi        := total_payable - (regular_emi * (loan_rec.tenure - 1));

        FOR cycle_num IN 1..loan_rec.tenure LOOP
            cycle_due_date := (loan_rec.approval_date + (cycle_num || ' months')::interval)::date;
            this_emi := CASE WHEN cycle_num = loan_rec.tenure THEN final_emi ELSE regular_emi END;

            INSERT INTO due_cycles (
                loan_id, cycle_number, due_date,
                base_emi, total_due, total_received,
                cycle_status
            ) VALUES (
                loan_rec.id, cycle_num, cycle_due_date,
                this_emi, this_emi, 0.00,
                CASE WHEN cycle_due_date < CURRENT_DATE THEN 'AWAITING_REVIEW'::cycle_status
                     ELSE 'UPCOMING'::cycle_status
                END
            );
        END LOOP;
    END LOOP;
END $$;


-- -----------------------------------------------------------
-- B9. EXTRA INDEXES ON loans FOR THE NEW LIFECYCLE QUERIES
-- -----------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_loans_approval_date
    ON loans (approval_date)
    WHERE is_deleted = FALSE;

-- Index to speed up the "loans needing nightly cycle review" query
CREATE INDEX IF NOT EXISTS idx_loans_status_active
    ON loans (status)
    WHERE is_deleted = FALSE AND status IN ('ACTIVE', 'AWAITING_CLOSURE', 'BAD_DEBT_PROPOSED');


COMMIT;


-- =============================================================
-- PART C: VERIFICATION QUERIES (run manually after COMMIT)
-- =============================================================

-- 1. Confirm all four new enums exist
-- SELECT typname FROM pg_type
-- WHERE typname IN ('punctuality_status','cycle_status','closure_type','bad_debt_proposal_status')
-- ORDER BY typname;
-- Expected: 4 rows

-- 2. Confirm new loan_status values were added
-- SELECT enumlabel FROM pg_enum
-- JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
-- WHERE pg_type.typname = 'loan_status'
-- ORDER BY enumsortorder;
-- Expected to include: ACTIVE, CLOSED, BAD_DEBT, DRAFT, AWAITING_CLOSURE, BAD_DEBT_PROPOSED

-- 3. Confirm new columns on existing tables
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'loans'
--   AND column_name IN ('penalty_rate','approval_date','due_day_of_month')
-- ORDER BY column_name;
-- Expected: 3 rows; penalty_rate NOT NULL with default 36.00

-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'transactions'
--   AND column_name IN ('effective_payment_date','punctuality_status','due_cycle_id')
-- ORDER BY column_name;
-- Expected: 3 rows; first two NOT NULL

-- 4. Confirm new tables exist
-- SELECT tablename FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('due_cycles','penalty_events','loan_closures','bad_debt_proposals')
-- ORDER BY tablename;
-- Expected: 4 rows

-- 5. Confirm due_cycles were generated for existing ACTIVE loans
-- SELECT l.loan_number,
--        l.tenure,
--        COUNT(c.id) AS cycles_created,
--        MIN(c.due_date) AS first_due,
--        MAX(c.due_date) AS last_due
-- FROM loans l
-- LEFT JOIN due_cycles c ON c.loan_id = l.id AND c.is_deleted = FALSE
-- WHERE l.status = 'ACTIVE' AND l.is_deleted = FALSE
-- GROUP BY l.id, l.loan_number, l.tenure
-- ORDER BY l.loan_number;
-- Expected: cycles_created = tenure for every loan; first_due ~ approval_date + 1 month

-- 6. Confirm legacy transactions got effective_payment_date + punctuality
-- SELECT punctuality_status, COUNT(*) FROM transactions GROUP BY punctuality_status;
-- Expected: all rows classified; SUCCESS -> PAID_ON_TIME, others -> AWAITING_REVIEW

-- 7. Confirm new triggers exist on the four new tables
-- SELECT event_object_table, trigger_name FROM information_schema.triggers
-- WHERE trigger_schema = 'public'
--   AND event_object_table IN ('due_cycles','loan_closures','bad_debt_proposals')
-- ORDER BY event_object_table;
-- Expected: 3 trigger rows (one updated_at trigger per table)

-- =============================================================
