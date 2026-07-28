import { z } from "zod";

/**
 * Visit Plans — request schemas (ADR-043, RULE-VP, WORKFLOW §2a).
 * A plan targets exactly one of lead / customer (DATABASE §5 CHECK).
 */

export const createVisitSchema = z
  .object({
    leadId: z.string().min(1).optional(),
    customerId: z.string().min(1).optional(),
    purpose: z.string().min(3, "Purpose is required"),
    plannedAt: z.coerce.date(),
    location: z.string().min(2, "Location is required"),
    assignedToId: z.string().min(1).optional(), // ASM/Management may assign; defaults to creator
  })
  .refine((d) => !!d.leadId !== !!d.customerId, {
    message: "Target exactly one of leadId or customerId",
  });

// Completion captures the outcome and becomes an outreach touch (RULE-VP-02).
export const completeVisitSchema = z.object({
  outcome: z.enum(["positive", "neutral", "negative"]),
  notes: z.string().optional(),
  followUpAt: z.coerce.date().optional(),
});

export const cancelVisitSchema = z.object({
  reason: z.string().min(3, "A cancellation reason is required"),
});

export const rescheduleVisitSchema = z.object({
  plannedAt: z.coerce.date(),
});
