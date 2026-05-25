-- =============================================================
-- Migration 009: Docs / Identity / Stability MVP hardening
-- Date: 2026-05-25
-- =============================================================
-- Closes the gaps surfaced in the module review:
--
--   X4  Schema drift — documents.customer_id and loans.customer_id are
--       currently NULLABLE=YES at the DB while the ORM models declare them
--       NOT NULL. Tighten the DB to match the code (and reality: a loan
--       always has a customer; a document is always uploaded against one).
--
--   I4  Partial unique indexes on identity_proofs:
--         (customer_id,  proof_type) WHERE is_deleted = false
--         (personnel_id, proof_type) WHERE is_deleted = false
--       Prevents a single entity from accumulating duplicate active proofs
--       of the same type (e.g. two active AADHAARs on one customer).
--
--   S2  CHECK constraint on stability_documents.cheque_count — required
--       (and >= 1) when doc_subtype = CHEQUE_PDC. The Pydantic layer
--       already enforces this; the DB CHECK closes the raw-SQL bypass.
--
--   S3  CHECK constraint on stability_documents.description length —
--       cap at 500 chars to match the Pydantic schema (was unbounded TEXT).
--
-- All operations are wrapped in a single transaction.  Run on an empty
-- documents / stability_documents table (per inspect_output row counts) so
-- no data backfill is required.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- X4: tighten nullability on FK columns that are effectively required
-- -------------------------------------------------------------
-- Pre-flight guards: fail loudly if any pre-existing NULLs would
-- prevent the SET NOT NULL. Cheap on small tables, and stops the
-- migration from leaving the schema partially applied.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM documents WHERE customer_id IS NULL) THEN
        RAISE EXCEPTION
            'documents has rows with NULL customer_id — fix data before tightening';
    END IF;
    IF EXISTS (SELECT 1 FROM loans WHERE customer_id IS NULL) THEN
        RAISE EXCEPTION
            'loans has rows with NULL customer_id — fix data before tightening';
    END IF;
END
$$;

ALTER TABLE documents ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE loans     ALTER COLUMN customer_id SET NOT NULL;


-- -------------------------------------------------------------
-- I4: one active identity proof per (entity, proof_type)
-- -------------------------------------------------------------
-- The existing idx_identity_proofs_customer_type is non-unique — replace it
-- with a partial UNIQUE so duplicates surface as a clean 409 instead of
-- silently piling up.  personnel_id branch had no equivalent index at all.
DROP INDEX IF EXISTS idx_identity_proofs_customer_type;

CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_proofs_customer_type_active
    ON identity_proofs (customer_id, proof_type)
    WHERE is_deleted = false AND customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_proofs_personnel_type_active
    ON identity_proofs (personnel_id, proof_type)
    WHERE is_deleted = false AND personnel_id IS NOT NULL;


-- -------------------------------------------------------------
-- S2: cheque_count must be set (>= 1) iff doc_subtype = CHEQUE_PDC
-- -------------------------------------------------------------
ALTER TABLE stability_documents
    DROP CONSTRAINT IF EXISTS ck_stability_cheque_count;

ALTER TABLE stability_documents
    ADD CONSTRAINT ck_stability_cheque_count
    CHECK (
        (doc_subtype <> 'CHEQUE_PDC' AND cheque_count IS NULL)
        OR
        (doc_subtype = 'CHEQUE_PDC' AND cheque_count IS NOT NULL AND cheque_count >= 1)
    );


-- -------------------------------------------------------------
-- S3: cap description length to match the Pydantic schema (500 chars)
-- -------------------------------------------------------------
ALTER TABLE stability_documents
    DROP CONSTRAINT IF EXISTS ck_stability_description_length;

ALTER TABLE stability_documents
    ADD CONSTRAINT ck_stability_description_length
    CHECK (description IS NULL OR char_length(description) <= 500);


COMMIT;

-- =============================================================
-- Verify:
--   SELECT column_name, is_nullable FROM information_schema.columns
--     WHERE table_name IN ('documents','loans') AND column_name='customer_id';
--   -- expected: NO for both rows.
--
--   SELECT indexname FROM pg_indexes
--     WHERE tablename='identity_proofs' AND indexname LIKE 'uq_%';
--   -- expected: uq_identity_proofs_customer_type_active,
--   --           uq_identity_proofs_personnel_type_active
--
--   SELECT conname FROM pg_constraint
--     WHERE conrelid = 'stability_documents'::regclass
--       AND conname LIKE 'ck_stability_%';
--   -- expected: ck_stability_cheque_count, ck_stability_description_length
-- =============================================================
