import { z } from "zod";
import { ShipmentStatus, DepartmentCode, StepActionKind, ShipmentKind } from "@prisma/client";
import { RECORD_TYPES } from "../../utils/composition.js";

/**
 * Workflow catalog admin — request schemas (ADR-051).
 *
 * Enum values come from the Prisma client at runtime, so a schema migration that
 * extends ShipmentStatus never needs a second edit here.
 */

// Mirrors otd_step_templates_code_format in prisma/sql/constraints.sql; keep in step.
export const STEP_CODE_RE = /^[a-z][a-z0-9_]{1,49}$/;

const STATUSES = Object.values(ShipmentStatus);
const DEPARTMENTS = Object.values(DepartmentCode);
const ACTION_KINDS = Object.values(StepActionKind);
const SHIPMENT_KINDS = Object.values(ShipmentKind);

const codeField = (what) =>
  z
    .string()
    .regex(STEP_CODE_RE, `${what} must be lowercase snake_case (letters, digits, _), 2–50 chars`);

const stepFields = {
  canonicalNo: z.coerce.number().int().min(1).max(999999),
  title: z.string().min(3).max(160),
  hint: z.string().max(500).nullish(),
  ownerDepartment: z.enum(DEPARTMENTS),
  // Which shipment kinds compose this step. Empty would compose nowhere, which is a
  // deactivation dressed up as a config — say so rather than let the step vanish.
  appliesToKinds: z
    .array(z.enum(SHIPMENT_KINDS))
    .nonempty("pick at least one shipment kind — use `active: false` to retire a step")
    .optional(),
  requiredDocTypes: z.array(codeField("docType")).optional(),
  dueOffsetHours: z.coerce.number().int().min(1).max(24 * 90).optional(),
  derivedStatus: z.enum(STATUSES),
  active: z.boolean().optional(),
};

export const createStepSchema = z.object({
  stepCode: codeField("stepCode"),
  ...stepFields,
});

// stepCode is IMMUTABLE: historical otd_steps rows resolve titles/docs/status by code
// forever, so renaming one would orphan them. `.strict()` makes a smuggled stepCode a
// 400 rather than a silent ignore.
export const updateStepSchema = z
  .object(Object.fromEntries(Object.entries(stepFields).map(([k, v]) => [k, v.optional()])))
  .strict();

export const replaceActionsSchema = z.object({
  actions: z
    .array(
      z
        .object({
          actionCode: codeField("actionCode"),
          title: z.string().min(3).max(160),
          kind: z.enum(ACTION_KINDS).default("manual"),
          docType: codeField("docType").nullish(),
          // `record` items name the register that satisfies them (ADR-057).
          recordType: z.enum(RECORD_TYPES).nullish(),
          sortOrder: z.coerce.number().int().min(0).max(999999),
          required: z.boolean().optional(),
        })
        // A document item IS its docType; a manual item must not carry one (its
        // satisfaction would silently never derive — ADR-048).
        .refine((a) => (a.kind === "document" ? !!a.docType : !a.docType), {
          path: ["docType"],
          message: "document items require a docType; manual and record items must not have one",
        })
        // Likewise a record item IS its recordType.
        .refine((a) => (a.kind === "record" ? !!a.recordType : !a.recordType), {
          path: ["recordType"],
          message: "record items require a recordType (contract | financial_instrument); other kinds must not have one",
        }),
    )
    .max(50),
});

export const createDocTypeSchema = z.object({
  code: codeField("code"),
  label: z.string().min(2).max(120),
  customerUploadable: z.boolean().optional(),
  // Documents of this type count towards a step gate only after Operations verifies
  // them — the signed Rate Confirmation before Order Lock is the reason it exists.
  requiresVerification: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999999).optional(),
});

export const updateDocTypeSchema = z
  .object({
    label: z.string().min(2).max(120).optional(),
    customerUploadable: z.boolean().optional(),
    requiresVerification: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(999999).optional(),
  })
  .strict();
