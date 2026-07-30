import { z } from "zod";
import { ShipmentStatus, DepartmentCode, ServicePackage, CroHandling, LcHandling, ServiceCode, StepActionKind } from "@prisma/client";

/**
 * Workflow catalog admin — request schemas (ADR-051).
 *
 * Enum values come from the Prisma client at runtime, so a schema migration that
 * extends ShipmentStatus / ServiceCode never needs a second edit here.
 */

// Mirrors otd_step_templates_code_format in prisma/sql/constraints.sql; keep in step.
export const STEP_CODE_RE = /^[a-z][a-z0-9_]{1,49}$/;

const STATUSES = Object.values(ShipmentStatus);
const DEPARTMENTS = Object.values(DepartmentCode);
const PACKAGES = Object.values(ServicePackage);
const CRO_MODES = Object.values(CroHandling);
const LC_MODES = Object.values(LcHandling);
const SERVICES = Object.values(ServiceCode);
const ACTION_KINDS = Object.values(StepActionKind);

const codeField = (what) =>
  z
    .string()
    .regex(STEP_CODE_RE, `${what} must be lowercase snake_case (letters, digits, _), 2–50 chars`);

const stepFields = {
  canonicalNo: z.coerce.number().int().min(1).max(999999),
  title: z.string().min(3).max(160),
  hint: z.string().max(500).nullish(),
  ownerDepartment: z.enum(DEPARTMENTS),
  always: z.boolean().optional(),
  packages: z.array(z.enum(PACKAGES)).optional(),
  croModes: z.array(z.enum(CRO_MODES)).optional(),
  lcModes: z.array(z.enum(LC_MODES)).optional(),
  services: z.array(z.enum(SERVICES)).optional(),
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
          sortOrder: z.coerce.number().int().min(0).max(999999),
          required: z.boolean().optional(),
          packages: z.array(z.enum(PACKAGES)).optional(),
          croModes: z.array(z.enum(CRO_MODES)).optional(),
          lcModes: z.array(z.enum(LC_MODES)).optional(),
          services: z.array(z.enum(SERVICES)).optional(),
        })
        // A document item IS its docType; a manual item must not carry one (its
        // satisfaction would silently never derive — ADR-048).
        .refine((a) => (a.kind === "document" ? !!a.docType : !a.docType), {
          path: ["docType"],
          message: "document items require a docType; manual items must not have one",
        }),
    )
    .max(50),
});

export const createDocTypeSchema = z.object({
  code: codeField("code"),
  label: z.string().min(2).max(120),
  customerUploadable: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999999).optional(),
});

export const updateDocTypeSchema = z
  .object({
    label: z.string().min(2).max(120).optional(),
    customerUploadable: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(999999).optional(),
  })
  .strict();
