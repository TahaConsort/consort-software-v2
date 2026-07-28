import { z } from "zod";

/**
 * OTC — request schemas (CRM_MASTER §5.10, RULE-FI-04).
 *
 * Manual milestones (3–5) carry no body of their own — the milestone number is
 * a path param and the amount is a display mirror (ADR-006). An optional note is
 * accepted for the audit diff.
 */
export const completeMilestoneSchema = z.object({
  notes: z.string().max(500).optional(),
});
