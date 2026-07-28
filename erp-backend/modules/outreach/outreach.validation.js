import { z } from "zod";

/**
 * Outreach — request schemas (CRM_MASTER §5.5).
 * A touch targets exactly one of lead / customer (DATABASE §5 CHECK).
 * Scheduled future visits are NOT outreach — they are Visit Plans (ADR-043);
 * outreach records touches that already happened.
 */

const OUTREACH_TYPES = ["call", "email", "meeting", "whatsapp", "linkedin", "site_visit"];
const OUTREACH_OUTCOMES = ["positive", "neutral", "negative", "no_response"];

export const createOutreachSchema = z
  .object({
    leadId: z.string().min(1).optional(),
    customerId: z.string().min(1).optional(),
    type: z.enum(OUTREACH_TYPES),
    outcome: z.enum(OUTREACH_OUTCOMES),
    notes: z.string().optional(),
    durationMin: z.coerce.number().int().positive().optional(),
    occurredAt: z.coerce.date().optional(),
    followUpAt: z.coerce.date().optional(), // feeds the follow-ups-due dashboard
  })
  .refine((d) => !!d.leadId !== !!d.customerId, {
    message: "Target exactly one of leadId or customerId",
  });
