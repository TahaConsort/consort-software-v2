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

-- Package ↔ CRO-mode consistency. Only loading_point_to_port and international have a
-- Container Release Order in play: local_transport has no container, and
-- port_to_consignee has one the line already released (the customer's delivery order
-- stands in for the CRO). Those two must be not_applicable; the export packages must
-- not be. A NULL service_package is a pre-package row and is exempt.
--
-- DROP-then-ADD rather than the ADD/EXCEPTION idiom used elsewhere in this file: these
-- definitions have CHANGED, and a bare ADD would swallow duplicate_object and silently
-- leave the OLD predicate in place — which rejects every port_to_consignee row.
-- Mirrors allowedCroModes() in utils/servicePackage.js; keep the two in step.
ALTER TABLE queries DROP CONSTRAINT IF EXISTS queries_cro_mode_valid;
ALTER TABLE queries ADD CONSTRAINT queries_cro_mode_valid CHECK (
  service_package IS NULL
  OR (service_package IN ('local_transport', 'port_to_consignee') AND cro_handled_by = 'not_applicable')
  OR (service_package NOT IN ('local_transport', 'port_to_consignee') AND cro_handled_by <> 'not_applicable')
);
ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_cro_mode_valid;
ALTER TABLE quotations ADD CONSTRAINT quotations_cro_mode_valid CHECK (
  service_package IS NULL
  OR (service_package IN ('local_transport', 'port_to_consignee') AND cro_handled_by = 'not_applicable')
  OR (service_package NOT IN ('local_transport', 'port_to_consignee') AND cro_handled_by <> 'not_applicable')
);
ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_cro_mode_valid;
ALTER TABLE shipments ADD CONSTRAINT shipments_cro_mode_valid CHECK (
  service_package IS NULL
  OR (service_package IN ('local_transport', 'port_to_consignee') AND cro_handled_by = 'not_applicable')
  OR (service_package NOT IN ('local_transport', 'port_to_consignee') AND cro_handled_by <> 'not_applicable')
);

-- Package ↔ LC-mode consistency (ADR-050). Only the export packages can trade under a
-- Letter of Credit; unlike the CRO, both may also run WITHOUT one (not_applicable =
-- "no-LC trade"), so the export side is unconstrained. A NULL service_package is a
-- pre-package row and is exempt. Mirrors allowedLcModes() in utils/servicePackage.js;
-- keep the two in step. ADD/EXCEPTION idiom: this definition has never changed.
DO $$ BEGIN
  ALTER TABLE queries ADD CONSTRAINT queries_lc_mode_valid CHECK (
    service_package IS NULL
    OR service_package NOT IN ('local_transport', 'port_to_consignee')
    OR lc_handled_by = 'not_applicable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE quotations ADD CONSTRAINT quotations_lc_mode_valid CHECK (
    service_package IS NULL
    OR service_package NOT IN ('local_transport', 'port_to_consignee')
    OR lc_handled_by = 'not_applicable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE shipments ADD CONSTRAINT shipments_lc_mode_valid CHECK (
    service_package IS NULL
    OR service_package NOT IN ('local_transport', 'port_to_consignee')
    OR lc_handled_by = 'not_applicable'
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

-- ADR-051 — step codes are admin-minted strings since the OtdStepCode enum was dropped
-- (prisma/sql/2026-07-step-code-to-text.sql). Guard the format at the source table; every
-- other step_code column references or copies this one. Mirrors STEP_CODE_RE in
-- modules/workflow/workflow.validation.js; keep the two in step.
DO $$ BEGIN
  ALTER TABLE otd_step_templates ADD CONSTRAINT otd_step_templates_code_format
    CHECK (step_code ~ '^[a-z][a-z0-9_]{1,49}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
