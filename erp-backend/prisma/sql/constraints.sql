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

-- RULE-QRY-05 / INV-14 — services can never be empty (now a free-text text[])
DO $$ BEGIN
  ALTER TABLE queries ADD CONSTRAINT queries_services_nonempty CHECK (cardinality(services) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE quotations ADD CONSTRAINT quotations_services_nonempty CHECK (cardinality(services) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE shipments ADD CONSTRAINT shipments_services_nonempty CHECK (cardinality(services) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Package / CRO-mode / LC-mode consistency: REMOVED. The service_package, cro_handled_by
-- and lc_handled_by columns no longer exist, so these six CHECKs have nothing to guard.
-- Postgres drops a CHECK automatically with the column it references, but the explicit
-- DROPs below make an already-migrated database converge whichever order it got there.
ALTER TABLE queries    DROP CONSTRAINT IF EXISTS queries_cro_mode_valid;
ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_cro_mode_valid;
ALTER TABLE shipments  DROP CONSTRAINT IF EXISTS shipments_cro_mode_valid;
ALTER TABLE queries    DROP CONSTRAINT IF EXISTS queries_lc_mode_valid;
ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_lc_mode_valid;
ALTER TABLE shipments  DROP CONSTRAINT IF EXISTS shipments_lc_mode_valid;

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

-- Vendor RFQ — at most one OPEN rate request per (query, service, leg). Cancelled
-- ones stay on the record and may be re-issued, which is why these are partial
-- rather than a plain @@unique in the schema. Truck/non-transport RFQs carry a NULL
-- leg; a rail inland service is asked once per leg. Two indexes rather than one
-- COALESCE expression because NULLs are never equal in a plain unique index.
--
-- DROP-then-CREATE rather than IF NOT EXISTS alone: the original definition was
-- (query_id, service) without the leg split, and a bare IF NOT EXISTS would leave
-- that old index in place — rejecting every per-leg rail batch with P2002.
DROP INDEX IF EXISTS vendor_rfqs_one_open_uq;
CREATE UNIQUE INDEX vendor_rfqs_one_open_uq
  ON vendor_rfqs (query_id, service) WHERE status = 'open' AND leg IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vendor_rfqs_one_open_leg_uq
  ON vendor_rfqs (query_id, service, leg) WHERE status = 'open' AND leg IS NOT NULL;

-- Vendor RFQ — at most one selected (winning) vendor quote per RFQ
CREATE UNIQUE INDEX IF NOT EXISTS vendor_quotes_one_selected_uq
  ON vendor_quotes (rfq_id) WHERE is_selected;

-- Vendor quote money is never negative
DO $$ BEGIN
  ALTER TABLE vendor_quote_lines ADD CONSTRAINT vendor_quote_lines_amount_nonneg CHECK (amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ADR-051 — step codes are admin-minted strings since the OtdStepCode enum was dropped
-- (prisma/sql/2026-07-step-code-to-text.sql). Guard the format at the source table; every
-- other step_code column references or copies this one. Mirrors STEP_CODE_RE in
-- modules/workflow/workflow.validation.js; keep the two in step.
DO $$ BEGIN
  ALTER TABLE otd_step_templates ADD CONSTRAINT otd_step_templates_code_format
    CHECK (step_code ~ '^[a-z][a-z0-9_]{1,49}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Export Shipment Workflow roadmap §2/§7 — a shipment party points at exactly one
-- party record: a `vendors` row (the party directory, which carries NTN/REX/IBAN) or a
-- CRM `customers` row acting as a party on its own shipment. Same idiom as
-- outreach_one_target above. Two DIFFERENT companies may share a role (the Ahmad Saeed
-- B/L carries two notify parties); the same company twice in one role is blocked by the
-- partial unique indexes Prisma generates from @@unique.
DO $$ BEGIN
  ALTER TABLE shipment_parties ADD CONSTRAINT shipment_parties_one_target
    CHECK (num_nonnulls(vendor_id, customer_id) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Export trade documents (roadmap §4) ──────────────────────────────────────
-- Money on a trade document is never negative, and an instrument can never be drawn
-- past its own value — the drawdown ledger is what Step 8 closes against.
DO $$ BEGIN
  ALTER TABLE financial_instruments ADD CONSTRAINT financial_instruments_value_positive CHECK (value > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE financial_instruments ADD CONSTRAINT financial_instruments_drawn_nonneg CHECK (drawn_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- "60% CAD / 40% DA" must not add up to more than the instrument.
DO $$ BEGIN
  ALTER TABLE financial_instruments ADD CONSTRAINT financial_instruments_split_valid
    CHECK (COALESCE(cad_percent, 0) + COALESCE(da_percent, 0) <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE financial_instrument_drawdowns ADD CONSTRAINT fi_drawdowns_amount_positive CHECK (amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE trade_invoice_lines ADD CONSTRAINT trade_invoice_lines_amount_nonneg CHECK (amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE packing_list_items ADD CONSTRAINT packing_list_items_counts_nonneg
    CHECK (COALESCE(boxes, 0) >= 0 AND COALESCE(pieces, 0) >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
