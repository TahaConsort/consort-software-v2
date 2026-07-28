import { z } from "zod";

/** OTD — request schemas (CRM_MASTER §5.9, RULE-SH-03/05/07). */

export const completeStepSchema = z.object({
  rowVersion: z.coerce.number().int().optional(), // If-Match (RULE-SH-07)
  forceReason: z.string().min(3).optional(), // required only for an out-of-order override (RULE-SH-03)
});

export const reopenStepSchema = z.object({
  reason: z.string().min(3, "A reopen reason is required (RULE-SH-05)"),
});

// One manual sub-action of a step (RULE-SH-13, ADR-048). `done` defaults to true so a
// plain PATCH ticks the item; send `{ done: false }` to untick it.
export const setStepActionSchema = z.object({
  done: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const updateStepDetailsSchema = z
  .object({
    notes: z.string().max(2000).nullable().optional(),
    formData: z.record(z.string(), z.any()).nullable().optional(), // free-form structured capture
  })
  .refine((b) => b.notes !== undefined || b.formData !== undefined, {
    message: "Provide notes or formData to save",
  });
