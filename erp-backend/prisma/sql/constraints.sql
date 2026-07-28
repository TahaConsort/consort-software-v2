-- DATABASE.md §5 — constraints Prisma cannot express.
-- Idempotent: safe to run repeatedly.
-- Apply manually:  npx prisma db execute --file prisma/sql/constraints.sql --schema prisma/schema.prisma

-- Case-insensitive unique login (EDGE-A-01 relies on one row per email)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email));

-- INV-05 — one primary contact per company
CREATE UNIQUE INDEX IF NOT EXISTS contacts_one_primary_uq
  ON contacts (company_id) WHERE is_primary;

-- INV-07 — at most one live (draft or sent) quotation per query
CREATE UNIQUE INDEX IF NOT EXISTS quotations_one_live_uq
  ON quotations (query_id) WHERE status IN ('draft', 'sent');

-- INV-08 — at most one approved quotation per query
CREATE UNIQUE INDEX IF NOT EXISTS quotations_one_approved_uq
  ON quotations (query_id) WHERE status = 'approved';

-- RULE-QRY-05 / INV-14 — services can never be empty
DO $$ BEGIN
  ALTER TABLE queries ADD CONSTRAINT queries_services_nonempty CHECK (cardinality(services) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE quotations ADD CONSTRAINT quotations_services_nonempty CHECK (cardinality(services) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE shipments ADD CONSTRAINT shipments_services_nonempty CHECK (cardinality(services) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Package ↔ CRO-mode consistency: only loading_point_to_port and international have a
-- CRO at all, so local_transport must be not_applicable and the other two must not be.
-- A NULL service_package is a pre-package row and is exempt.
DO $$ BEGIN
  ALTER TABLE queries ADD CONSTRAINT queries_cro_mode_valid CHECK (
    service_package IS NULL
    OR (service_package = 'local_transport' AND cro_handled_by = 'not_applicable')
    OR (service_package <> 'local_transport' AND cro_handled_by <> 'not_applicable')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE quotations ADD CONSTRAINT quotations_cro_mode_valid CHECK (
    service_package IS NULL
    OR (service_package = 'local_transport' AND cro_handled_by = 'not_applicable')
    OR (service_package <> 'local_transport' AND cro_handled_by <> 'not_applicable')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE shipments ADD CONSTRAINT shipments_cro_mode_valid CHECK (
    service_package IS NULL
    OR (service_package = 'local_transport' AND cro_handled_by = 'not_applicable')
    OR (service_package <> 'local_transport' AND cro_handled_by <> 'not_applicable')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Outreach / Visit Plans target exactly one of lead, customer
DO $$ BEGIN
  ALTER TABLE outreach ADD CONSTRAINT outreach_one_target
    CHECK (num_nonnulls(lead_id, customer_id) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE visit_plans ADD CONSTRAINT visit_plans_one_target
    CHECK (num_nonnulls(lead_id, customer_id) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ADR-038 — a task is held iff sla_paused_at is set (both columns set or both null)
DO $$ BEGIN
  ALTER TABLE tasks ADD CONSTRAINT tasks_hold_pair
    CHECK ((sla_paused_at IS NULL) = (status_before_hold IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Positive money
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_amount_nonneg CHECK (amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
