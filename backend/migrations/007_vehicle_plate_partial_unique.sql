-- =============================================================
-- Migration 007: vehicles.plate_number uniqueness scope
-- Date: 2026-05-22
-- =============================================================
-- The current vehicles_plate_number_key is a GLOBAL unique constraint.
-- Two problems:
--   1. India RTO can reassign a retired plate to a new vehicle. With a
--      global unique, the old (soft-deleted) row blocks the new one.
--   2. The service layer (get_vehicle_by_plate) already filters by
--      is_deleted=false, so the service check and the DB constraint
--      disagreed — collisions surfaced as 500s instead of clean 409s.
--
-- Fix: replace the global unique with a partial unique that only applies
-- to active (is_deleted=false) rows. This matches reality and the
-- service-layer expectation. Chassis number stays globally unique because
-- VINs are permanent and must never be reused (NBFC audit requirement).
-- =============================================================

BEGIN;

-- Drop the old global constraint + its backing index.
ALTER TABLE vehicles
    DROP CONSTRAINT IF EXISTS vehicles_plate_number_key;

-- Partial unique index — only active rows participate in uniqueness.
-- Named for clarity in IntegrityError diagnostics
-- (see app/services/vehicle.py:_VEHICLE_CONSTRAINT_MESSAGES).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_plate_number_active
    ON vehicles (plate_number)
    WHERE is_deleted = false;

COMMIT;

-- =============================================================
-- Verify:
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE tablename = 'vehicles' AND indexname LIKE '%plate%';
--   Expected: uq_vehicles_plate_number_active ... WHERE (is_deleted = false)
--
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'vehicles'::regclass AND contype = 'u';
--   Expected: vehicles_chassis_number_key only (no plate constraint).
-- =============================================================
