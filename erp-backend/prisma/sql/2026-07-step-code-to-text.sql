-- One-shot migration (ADR-051): OtdStepCode enum → text, so the Workflow admin
-- panel can create brand-new steps without a schema change.
--
-- Apply BEFORE deploying the schema.prisma that drops the enum:
--   npx prisma db execute --file prisma/sql/2026-07-step-code-to-text.sql --schema prisma/schema.prisma
--
-- The FK between the two template tables cannot bridge text↔enum, so it is
-- dropped, both sides converted, then re-added — all one transaction. Codes are
-- format-guarded afterwards by otd_step_templates_code_format (constraints.sql).
--
-- Rollback (only while every stored code is one of the 28 legacy labels):
-- recreate the enum, drop the FK, ALTER each column back with USING ...::"OtdStepCode",
-- re-add the FK, and restore the enum block in schema.prisma.

BEGIN;

ALTER TABLE otd_step_action_templates DROP CONSTRAINT IF EXISTS otd_step_action_templates_step_code_fkey;

ALTER TABLE otd_step_templates        ALTER COLUMN step_code         TYPE text USING step_code::text;
ALTER TABLE otd_step_action_templates ALTER COLUMN step_code         TYPE text USING step_code::text;
ALTER TABLE otd_steps                 ALTER COLUMN step_code         TYPE text USING step_code::text;
ALTER TABLE task_templates            ALTER COLUMN step_code         TYPE text USING step_code::text;
ALTER TABLE charge_types              ALTER COLUMN default_step_code TYPE text USING default_step_code::text;

ALTER TABLE otd_step_action_templates
  ADD CONSTRAINT otd_step_action_templates_step_code_fkey
  FOREIGN KEY (step_code) REFERENCES otd_step_templates(step_code)
  ON DELETE CASCADE ON UPDATE CASCADE;

DROP TYPE IF EXISTS "OtdStepCode";

COMMIT;
