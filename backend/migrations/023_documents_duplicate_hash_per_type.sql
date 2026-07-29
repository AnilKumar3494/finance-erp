-- =============================================================
-- Migration 023: Scope the document duplicate check to the doc type
-- Date: 2026-07-29
-- =============================================================
-- The partial unique index `uq_documents_customer_hash_active` was keyed on
-- (customer_id, file_hash), so a customer could hold any given file exactly
-- ONCE, whatever it was filed as. In practice one scan legitimately serves
-- two purposes — an Aadhaar page uploaded as IDENTITY_PROOF and again as
-- part of the KYC set, a single PDF that is both the loan agreement and the
-- archive copy — and the second upload was rejected with the generic
-- "A record with these unique details already exists.", which tells staff
-- neither what collided nor what to do about it.
--
-- This adds doc_type to the key. The genuine mistake the index exists to
-- stop — uploading the same file twice for the same purpose — is still
-- blocked, and now reports a message that names the cause (see
-- app/utils/db_errors.py). The service also pre-checks the same triple
-- before the S3 PutObject so a duplicate no longer costs an upload that has
-- to be rolled back.
--
-- HOW TO RUN:
--   python migrate.py apply        # preferred — records in schema_migrations
--   python migrate.py status       # list applied vs. pending
--
-- SAFETY: Fully transactional and re-runnable via IF [NOT] EXISTS guards.
--         This RELAXES a constraint (every key unique under the old index is
--         still unique under the new one), so it cannot fail on existing
--         data. Reversing it is NOT automatic: once a customer holds the
--         same bytes under two doc types, the old index cannot be recreated
--         until one of them is removed.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- Replace the customer-wide duplicate key with a per-type one
-- -------------------------------------------------------------
DROP INDEX IF EXISTS uq_documents_customer_hash_active;

CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_customer_type_hash_active
    ON documents (customer_id, doc_type, file_hash)
    WHERE (is_deleted = false AND file_hash IS NOT NULL);

COMMIT;

-- -------------------------------------------------------------
-- VERIFICATION (run manually after COMMIT)
-- -------------------------------------------------------------
-- 1. Old index gone, new one present:
--    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'documents';
--    -- expect uq_documents_customer_type_hash_active,
--    --        NOT uq_documents_customer_hash_active
--
-- 2. No duplicate would have been created by the relaxation:
--    SELECT customer_id, doc_type, file_hash, count(*)
--    FROM documents
--    WHERE is_deleted = false AND file_hash IS NOT NULL
--    GROUP BY 1, 2, 3 HAVING count(*) > 1;
--    -- expect 0 rows
--
-- 3. The same file now uploads under a second doc_type, and a second time
--    under the SAME doc_type still fails.
-- =============================================================
