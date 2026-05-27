-- =============================================================
-- Migration 012: collapse VEHICLE_IMAGE into VEHICLE_PHOTO
-- Date: 2026-05-27
-- =============================================================
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- Why
-- ---
-- The May 2026 customer-flow redesign (migration 001) added VEHICLE_PHOTO
-- as the new name for vehicle imagery (including the customer-with-vehicle
-- shot — that case is a frontend-flagged member of VEHICLE_PHOTO, not its
-- own doc_type). VEHICLE_IMAGE was left in place "for backward compat".
--
-- Both values:
--   - require vehicle_id and only vehicle_id (same CHECK clause shape),
--   - go through the same `_VEHICLE_LINKED` branch in document.py,
--   - mean exactly the same thing to every consumer.
--
-- Keeping two synonyms invites new writes to drift onto the legacy value
-- and forces every reader to know they're equivalent. This migration
-- merges them: existing VEHICLE_IMAGE rows are rewritten to VEHICLE_PHOTO
-- and the doc_category enum is rebuilt without VEHICLE_IMAGE.
--
-- Why a rebuild and not ALTER TYPE ... DROP VALUE
-- -----------------------------------------------
-- Postgres has no "DROP VALUE" for enums. The supported removal pattern
-- is: rename the old type aside, create a fresh enum, cast the column
-- across via text, drop the old type. Cheap on this table (single
-- column, low row count) and atomic inside one transaction.
--
-- The CHECK constraint ck_documents_type_link_consistency embeds the
-- literal 'VEHICLE_IMAGE'::doc_category, so it must be dropped before
-- the type swap and recreated after — otherwise the cast fails on the
-- constraint's stale enum reference.
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. Backfill: rewrite legacy rows to the canonical value.
-- ---------------------------------------------------------------
UPDATE documents
   SET doc_type = 'VEHICLE_PHOTO'::doc_category
 WHERE doc_type = 'VEHICLE_IMAGE'::doc_category;

-- ---------------------------------------------------------------
-- 2. Drop the CHECK constraint that references the old enum value.
--    Re-added below with the trimmed value list.
-- ---------------------------------------------------------------
ALTER TABLE documents DROP CONSTRAINT ck_documents_type_link_consistency;

-- ---------------------------------------------------------------
-- 3. Rebuild doc_category without VEHICLE_IMAGE.
--    - Rename current type aside.
--    - Create the new type with the same values minus VEHICLE_IMAGE.
--    - Convert documents.doc_type via text cast (safe because we just
--      backfilled away every value not present in the new enum).
--    - Drop the old type.
-- ---------------------------------------------------------------
ALTER TYPE doc_category RENAME TO doc_category_old;

CREATE TYPE doc_category AS ENUM (
    'ARCHIVE',
    'KYC',
    'LOAN_AGREEMENT',
    'RECEIPT',
    'IDENTITY_PROOF',
    'STABILITY_DOC',
    'RC_COPY',
    'INSURANCE_POLICY',
    'VEHICLE_PHOTO'
);

ALTER TABLE documents
    ALTER COLUMN doc_type TYPE doc_category
    USING doc_type::text::doc_category;

DROP TYPE doc_category_old;

-- ---------------------------------------------------------------
-- 4. Re-add the link-consistency CHECK, minus the VEHICLE_IMAGE arm.
-- ---------------------------------------------------------------
ALTER TABLE documents ADD CONSTRAINT ck_documents_type_link_consistency CHECK (
    (doc_type = 'KYC'::doc_category              AND loan_id IS NULL      AND transaction_id IS NULL AND vehicle_id IS NULL) OR
    (doc_type = 'IDENTITY_PROOF'::doc_category   AND loan_id IS NULL      AND transaction_id IS NULL AND vehicle_id IS NULL) OR
    (doc_type = 'LOAN_AGREEMENT'::doc_category   AND loan_id IS NOT NULL) OR
    (doc_type = 'RECEIPT'::doc_category          AND transaction_id IS NOT NULL) OR
    (doc_type = 'RC_COPY'::doc_category          AND vehicle_id IS NOT NULL) OR
    (doc_type = 'INSURANCE_POLICY'::doc_category AND vehicle_id IS NOT NULL) OR
    (doc_type = 'VEHICLE_PHOTO'::doc_category    AND vehicle_id IS NOT NULL) OR
    (doc_type = 'STABILITY_DOC'::doc_category    AND loan_id IS NOT NULL) OR
    (doc_type = 'ARCHIVE'::doc_category)
);

-- ---------------------------------------------------------------
-- 5. Post-flight: fail loudly if anything still references the old
--    value. Belt-and-braces — the type is already gone, so any stray
--    reference would have errored above.
-- ---------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'doc_category'
           AND e.enumlabel = 'VEHICLE_IMAGE'
    ) THEN
        RAISE EXCEPTION 'doc_category still contains VEHICLE_IMAGE after rebuild';
    END IF;
END
$$;

COMMIT;

-- =============================================================
-- Verify:
--   SELECT enumlabel FROM pg_enum
--     JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
--    WHERE pg_type.typname = 'doc_category'
--    ORDER BY enumsortorder;
--   -- expected 9 rows, none equal to VEHICLE_IMAGE
--
--   SELECT doc_type, count(*) FROM documents GROUP BY 1 ORDER BY 1;
--   -- expected: no row with doc_type = VEHICLE_IMAGE
-- =============================================================
