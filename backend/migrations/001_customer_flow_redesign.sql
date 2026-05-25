-- =============================================================
-- Migration 001: Customer Flow Redesign
-- Date: 2026-05-13
-- =============================================================
-- SECTIONS:
--   PART A  — New enums + additions to existing enums
--   PART B  — Everything else (transactional)
--             B1. Modify existing tables
--             B2. Update documents check constraint
--             B3. Create personnel table
--             B4. Create loan_personnel table
--             B5. Create identity_proofs table
--             B6. Create stability_documents table
--             B7. Drop duplicate updated_at triggers
--
-- HOW TO RUN:
--   psql -U postgres -d <your_database> -f 001_customer_flow_redesign.sql
--
-- NOTE ON ENUMS:
--   ALTER TYPE ADD VALUE cannot be rolled back in any PG version.
--   It is intentionally placed outside the transaction in PART A.
--   If this migration fails mid-way in PART B, re-running PART A
--   is safe (IF NOT EXISTS guards are in place). Re-run only PART B
--   after fixing the issue.
-- =============================================================


-- =============================================================
-- PART A: ENUM CHANGES  (outside transaction)
-- =============================================================

-- New enum: role for guarantor / co-hirer (lives on loan_personnel join)
CREATE TYPE personnel_role AS ENUM (
    'GUARANTOR',
    'CO_HIRER'
);

-- New enum: identity proof document types
CREATE TYPE identity_proof_type AS ENUM (
    'AADHAAR',
    'PAN',
    'DRIVING_LICENSE',
    'RATION_CARD',
    'VOTER_ID',
    'MGNREGA_CARD',
    'OTHER'
);

-- New enum: stability verification document subtypes
CREATE TYPE stability_doc_type AS ENUM (
    'PROPERTY_TAX',
    'ELECTRICITY_BILL',
    'BANK_STATEMENT',
    'CHEQUE_PDC',
    'OTHER'
);

-- New enum: distinguishes regular EMI payments from down payments in transactions
CREATE TYPE transaction_type AS ENUM (
    'REGULAR',
    'DOWN_PAYMENT'
);

-- Extend existing doc_category enum with new document types
ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'IDENTITY_PROOF';   -- identity proof uploads (Aadhaar, PAN, DL, etc.)
ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'STABILITY_DOC';    -- stability verification uploads
ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'RC_COPY';          -- vehicle RC document
ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'INSURANCE_POLICY'; -- vehicle insurance policy
ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'VEHICLE_PHOTO';    -- vehicle photos incl. customer-with-vehicle


-- =============================================================
-- PART B: ALL OTHER CHANGES  (transactional)
-- =============================================================

BEGIN;

-- -----------------------------------------------------------
-- B1. MODIFY EXISTING TABLES
-- -----------------------------------------------------------

-- customers: add address, contact, and personal fields
ALTER TABLE customers
    ADD COLUMN date_of_birth      DATE,
    ADD COLUMN alt_mobile_number  VARCHAR(15),
    ADD COLUMN address_line_1     TEXT,
    ADD COLUMN address_line_2     TEXT,
    ADD COLUMN mandal_village     VARCHAR(100),
    ADD COLUMN remarks            TEXT;

-- vehicles: add engine number
ALTER TABLE vehicles
    ADD COLUMN engine_number VARCHAR(50);

-- loans: add finance fields (default 0 keeps existing rows valid)
ALTER TABLE loans
    ADD COLUMN down_payment      NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN processing_fee    NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN documentation_fee NUMERIC(15,2) NOT NULL DEFAULT 0.00;

ALTER TABLE loans
    ADD CONSTRAINT loans_down_payment_check      CHECK (down_payment >= 0),
    ADD CONSTRAINT loans_processing_fee_check    CHECK (processing_fee >= 0),
    ADD CONSTRAINT loans_documentation_fee_check CHECK (documentation_fee >= 0);

-- transactions: add type column (existing rows default to REGULAR)
ALTER TABLE transactions
    ADD COLUMN transaction_type transaction_type NOT NULL DEFAULT 'REGULAR';

CREATE INDEX idx_transactions_type
    ON transactions(transaction_type)
    WHERE is_deleted = FALSE;


-- -----------------------------------------------------------
-- B2. UPDATE DOCUMENTS CHECK CONSTRAINT
-- Drops the old constraint and recreates it to cover the 5 new
-- doc_category values added in PART A.
-- -----------------------------------------------------------

ALTER TABLE documents DROP CONSTRAINT ck_documents_type_link_consistency;

ALTER TABLE documents ADD CONSTRAINT ck_documents_type_link_consistency CHECK (
    (doc_type = 'KYC'::doc_category              AND loan_id IS NULL      AND transaction_id IS NULL AND vehicle_id IS NULL) OR
    (doc_type = 'IDENTITY_PROOF'::doc_category   AND loan_id IS NULL      AND transaction_id IS NULL AND vehicle_id IS NULL) OR
    (doc_type = 'LOAN_AGREEMENT'::doc_category   AND loan_id IS NOT NULL) OR
    (doc_type = 'RECEIPT'::doc_category          AND transaction_id IS NOT NULL) OR
    (doc_type = 'VEHICLE_IMAGE'::doc_category    AND vehicle_id IS NOT NULL) OR
    (doc_type = 'RC_COPY'::doc_category          AND vehicle_id IS NOT NULL) OR
    (doc_type = 'INSURANCE_POLICY'::doc_category AND vehicle_id IS NOT NULL) OR
    (doc_type = 'VEHICLE_PHOTO'::doc_category    AND vehicle_id IS NOT NULL) OR
    (doc_type = 'STABILITY_DOC'::doc_category    AND loan_id IS NOT NULL) OR
    (doc_type = 'ARCHIVE'::doc_category)
);


-- -----------------------------------------------------------
-- B3. CREATE personnel TABLE
-- Stores Guarantor and Co-Hirer entities.
-- Role (GUARANTOR/CO_HIRER) lives on loan_personnel, not here,
-- because the same person can hold different roles on different loans.
-- -----------------------------------------------------------

CREATE TABLE personnel (
    id                UUID         NOT NULL DEFAULT gen_random_uuid(),
    full_name         VARCHAR(255) NOT NULL,
    date_of_birth     DATE,
    mobile_number     VARCHAR(15)  NOT NULL,
    alt_mobile_number VARCHAR(15),
    aadhaar_number    VARCHAR(12),
    pan_number        VARCHAR(10),
    address_line_1    TEXT,
    address_line_2    TEXT,
    mandal_village    VARCHAR(100),
    remarks           TEXT,
    is_deleted        BOOLEAN      NOT NULL DEFAULT FALSE,
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id     UUID,
    updated_by_id     UUID,
    deleted_by_id     UUID,

    CONSTRAINT personnel_pkey               PRIMARY KEY (id),
    CONSTRAINT personnel_mobile_number_key  UNIQUE (mobile_number),
    CONSTRAINT check_soft_delete_personnel  CHECK (
        (is_deleted = FALSE AND deleted_at IS NULL) OR
        (is_deleted = TRUE  AND deleted_at IS NOT NULL)
    ),
    CONSTRAINT personnel_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT personnel_updated_by_id_fkey FOREIGN KEY (updated_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT personnel_deleted_by_id_fkey FOREIGN KEY (deleted_by_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Partial unique: Aadhaar and PAN are unique within personnel when present.
-- No cross-table check with customers (same Aadhaar can exist in both tables).
CREATE UNIQUE INDEX uq_personnel_aadhaar
    ON personnel(aadhaar_number)
    WHERE aadhaar_number IS NOT NULL;

CREATE UNIQUE INDEX uq_personnel_pan
    ON personnel(pan_number)
    WHERE pan_number IS NOT NULL;

CREATE INDEX idx_personnel_active
    ON personnel(id)
    WHERE is_deleted = FALSE;

CREATE INDEX idx_personnel_mobile
    ON personnel(mobile_number)
    WHERE is_deleted = FALSE;

CREATE INDEX idx_personnel_creator
    ON personnel(created_by_id);

CREATE TRIGGER trigger_update_personnel_updated_at
    BEFORE UPDATE ON personnel
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------
-- B4. CREATE loan_personnel TABLE
-- Join table: a loan can have multiple guarantors and co-hirers.
-- The same person can be GUARANTOR on one loan and CO_HIRER on another.
-- -----------------------------------------------------------

CREATE TABLE loan_personnel (
    id                    UUID            NOT NULL DEFAULT gen_random_uuid(),
    loan_id               UUID            NOT NULL,
    personnel_id          UUID            NOT NULL,
    role                  personnel_role  NOT NULL,
    relationship_to_hirer VARCHAR(100),
    is_deleted            BOOLEAN         NOT NULL DEFAULT FALSE,
    deleted_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id         UUID,
    updated_by_id         UUID,
    deleted_by_id         UUID,

    CONSTRAINT loan_personnel_pkey              PRIMARY KEY (id),
    CONSTRAINT check_soft_delete_loan_personnel CHECK (
        (is_deleted = FALSE AND deleted_at IS NULL) OR
        (is_deleted = TRUE  AND deleted_at IS NOT NULL)
    ),
    CONSTRAINT loan_personnel_loan_id_fkey       FOREIGN KEY (loan_id)       REFERENCES loans(id)     ON DELETE RESTRICT,
    CONSTRAINT loan_personnel_personnel_id_fkey  FOREIGN KEY (personnel_id)  REFERENCES personnel(id) ON DELETE RESTRICT,
    CONSTRAINT loan_personnel_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES users(id)     ON DELETE SET NULL,
    CONSTRAINT loan_personnel_updated_by_id_fkey FOREIGN KEY (updated_by_id) REFERENCES users(id)     ON DELETE SET NULL,
    CONSTRAINT loan_personnel_deleted_by_id_fkey FOREIGN KEY (deleted_by_id) REFERENCES users(id)     ON DELETE SET NULL
);

-- Prevents the same person being added in the same role on the same loan twice
CREATE UNIQUE INDEX uq_loan_personnel_active
    ON loan_personnel(loan_id, personnel_id, role)
    WHERE is_deleted = FALSE;

CREATE INDEX idx_loan_personnel_loan
    ON loan_personnel(loan_id)
    WHERE is_deleted = FALSE;

CREATE INDEX idx_loan_personnel_personnel
    ON loan_personnel(personnel_id)
    WHERE is_deleted = FALSE;

CREATE TRIGGER trigger_update_loan_personnel_updated_at
    BEFORE UPDATE ON loan_personnel
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------
-- B5. CREATE identity_proofs TABLE
-- Stores identity proof slots for both customers and personnel.
-- Exactly one of (customer_id, personnel_id) must be set per row.
-- -----------------------------------------------------------

CREATE TABLE identity_proofs (
    id            UUID                NOT NULL DEFAULT gen_random_uuid(),
    customer_id   UUID,
    personnel_id  UUID,
    proof_type    identity_proof_type NOT NULL,
    id_number     VARCHAR(50),
    document_id   UUID,
    is_deleted    BOOLEAN             NOT NULL DEFAULT FALSE,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id UUID,
    updated_by_id UUID,
    deleted_by_id UUID,

    CONSTRAINT identity_proofs_pkey              PRIMARY KEY (id),
    -- Exactly one owner: either a customer or a personnel, never both, never neither
    CONSTRAINT ck_identity_proof_owner           CHECK (
        (customer_id IS NOT NULL AND personnel_id IS NULL) OR
        (customer_id IS NULL     AND personnel_id IS NOT NULL)
    ),
    CONSTRAINT check_soft_delete_identity_proofs CHECK (
        (is_deleted = FALSE AND deleted_at IS NULL) OR
        (is_deleted = TRUE  AND deleted_at IS NOT NULL)
    ),
    CONSTRAINT identity_proofs_customer_id_fkey   FOREIGN KEY (customer_id)   REFERENCES customers(id)  ON DELETE RESTRICT,
    CONSTRAINT identity_proofs_personnel_id_fkey  FOREIGN KEY (personnel_id)  REFERENCES personnel(id)  ON DELETE RESTRICT,
    CONSTRAINT identity_proofs_document_id_fkey   FOREIGN KEY (document_id)   REFERENCES documents(id)  ON DELETE SET NULL,
    CONSTRAINT identity_proofs_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES users(id)      ON DELETE SET NULL,
    CONSTRAINT identity_proofs_updated_by_id_fkey FOREIGN KEY (updated_by_id) REFERENCES users(id)      ON DELETE SET NULL,
    CONSTRAINT identity_proofs_deleted_by_id_fkey FOREIGN KEY (deleted_by_id) REFERENCES users(id)      ON DELETE SET NULL
);

CREATE INDEX idx_identity_proofs_customer
    ON identity_proofs(customer_id)
    WHERE is_deleted = FALSE;

CREATE INDEX idx_identity_proofs_personnel
    ON identity_proofs(personnel_id)
    WHERE is_deleted = FALSE;

-- Composite index for DL auto-sync lookup:
-- "does this customer already have a DRIVING_LICENSE proof uploaded?"
CREATE INDEX idx_identity_proofs_customer_type
    ON identity_proofs(customer_id, proof_type)
    WHERE is_deleted = FALSE;

CREATE TRIGGER trigger_update_identity_proofs_updated_at
    BEFORE UPDATE ON identity_proofs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------
-- B6. CREATE stability_documents TABLE
-- Per-loan stability verification. Multiple rows allowed per loan.
-- Min-2 rule is enforced in the frontend only.
-- -----------------------------------------------------------

CREATE TABLE stability_documents (
    id            UUID               NOT NULL DEFAULT gen_random_uuid(),
    loan_id       UUID               NOT NULL,
    doc_subtype   stability_doc_type NOT NULL,
    description   TEXT,
    cheque_count  INTEGER,
    document_id   UUID,
    is_deleted    BOOLEAN            NOT NULL DEFAULT FALSE,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id UUID,
    updated_by_id UUID,
    deleted_by_id UUID,

    CONSTRAINT stability_documents_pkey             PRIMARY KEY (id),
    CONSTRAINT check_soft_delete_stability_docs     CHECK (
        (is_deleted = FALSE AND deleted_at IS NULL) OR
        (is_deleted = TRUE  AND deleted_at IS NOT NULL)
    ),
    CONSTRAINT stability_docs_loan_id_fkey          FOREIGN KEY (loan_id)       REFERENCES loans(id)     ON DELETE RESTRICT,
    CONSTRAINT stability_docs_document_id_fkey      FOREIGN KEY (document_id)   REFERENCES documents(id) ON DELETE SET NULL,
    CONSTRAINT stability_docs_created_by_id_fkey    FOREIGN KEY (created_by_id) REFERENCES users(id)     ON DELETE SET NULL,
    CONSTRAINT stability_docs_updated_by_id_fkey    FOREIGN KEY (updated_by_id) REFERENCES users(id)     ON DELETE SET NULL,
    CONSTRAINT stability_docs_deleted_by_id_fkey    FOREIGN KEY (deleted_by_id) REFERENCES users(id)     ON DELETE SET NULL
);

CREATE INDEX idx_stability_docs_loan
    ON stability_documents(loan_id)
    WHERE is_deleted = FALSE;

CREATE TRIGGER trigger_update_stability_documents_updated_at
    BEFORE UPDATE ON stability_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------
-- B7. DROP DUPLICATE updated_at TRIGGERS
-- Each of customers, loans, vehicles, users has two triggers
-- that both set updated_at = NOW().
-- Keeping:  trigger_update_*_updated_at  (update_updated_at_column)
-- Dropping: trg_*_updated_at             (set_updated_at) — redundant
-- documents and transactions already have only one trigger each.
-- -----------------------------------------------------------

DROP TRIGGER trg_customers_updated_at ON customers;
DROP TRIGGER trg_loans_updated_at     ON loans;
DROP TRIGGER trg_vehicles_updated_at  ON vehicles;
DROP TRIGGER trg_users_updated_at     ON users;


COMMIT;


-- =============================================================
-- VERIFICATION QUERIES
-- Run these after the migration to confirm everything applied.
-- =============================================================

-- 1. Confirm all 4 new enums exist
SELECT typname FROM pg_type
WHERE typname IN ('personnel_role','identity_proof_type','stability_doc_type','transaction_type')
ORDER BY typname;
-- Expected: 4 rows

-- 2. Confirm new doc_category values
SELECT enumlabel FROM pg_enum
JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
WHERE pg_type.typname = 'doc_category'
ORDER BY enumsortorder;
-- Expected: 10 values including IDENTITY_PROOF, STABILITY_DOC, RC_COPY, INSURANCE_POLICY, VEHICLE_PHOTO

-- 3. Confirm new columns on existing tables
SELECT column_name FROM information_schema.columns
WHERE table_name = 'customers'
  AND column_name IN ('date_of_birth','alt_mobile_number','address_line_1','address_line_2','mandal_village','remarks')
ORDER BY column_name;
-- Expected: 6 rows

SELECT column_name FROM information_schema.columns
WHERE table_name = 'vehicles' AND column_name = 'engine_number';
-- Expected: 1 row

SELECT column_name FROM information_schema.columns
WHERE table_name = 'loans'
  AND column_name IN ('down_payment','processing_fee','documentation_fee')
ORDER BY column_name;
-- Expected: 3 rows

SELECT column_name FROM information_schema.columns
WHERE table_name = 'transactions' AND column_name = 'transaction_type';
-- Expected: 1 row

-- 4. Confirm new tables exist
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('personnel','loan_personnel','identity_proofs','stability_documents')
ORDER BY tablename;
-- Expected: 4 rows

-- 5. Confirm only one updated_at trigger per table now
SELECT event_object_table, COUNT(*) AS trigger_count
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('customers','loans','vehicles','users')
GROUP BY event_object_table
ORDER BY event_object_table;
-- Expected: all 4 tables showing count = 1

-- 6. Confirm updated documents constraint covers new types
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'ck_documents_type_link_consistency';
-- Expected: long CHECK definition including RC_COPY, INSURANCE_POLICY, etc.
