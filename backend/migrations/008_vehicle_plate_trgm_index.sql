-- =============================================================
-- Migration 008: vehicles.plate_number trigram search index
-- Date: 2026-05-22
-- =============================================================
-- list_vehicles() does ILIKE '%X%' on plate_number, which cannot use a
-- btree index because of the leading wildcard. At MVP scale that's a
-- full table scan on every list request. A GIN trigram index makes
-- substring search index-resident.
--
-- pg_trgm is contrib but ships with every modern PostgreSQL install
-- (incl. RDS). It is idempotent to enable. Index is also IF NOT EXISTS
-- so re-runs are safe.
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ix_vehicles_plate_number_trgm
    ON vehicles USING GIN (plate_number gin_trgm_ops);

COMMIT;

-- =============================================================
-- Verify:
--   SELECT extname FROM pg_extension WHERE extname='pg_trgm';
--   SELECT indexdef FROM pg_indexes
--   WHERE tablename='vehicles' AND indexname='ix_vehicles_plate_number_trgm';
--
-- Expected plan after migration (substring search now index-resident):
--   EXPLAIN SELECT * FROM vehicles
--   WHERE plate_number ILIKE '%AP09%' AND is_deleted = false;
--   -> Bitmap Index Scan on ix_vehicles_plate_number_trgm
-- =============================================================
