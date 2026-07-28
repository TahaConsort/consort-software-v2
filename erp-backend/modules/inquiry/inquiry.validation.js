import { z } from "zod";

/**
 * Public Inquiry triage schemas (CRM_MASTER §5.20, WORKFLOW §2b).
 */

export const updateInquiryStatusSchema = z.object({
  status: z.enum(["reviewing", "spam", "closed"]),
});

// Convert → lead(direct) + customer + query. Overrides are optional; the
// converting salesperson is the default owner/BDO.
export const convertInquirySchema = z.object({
  ownerId: z.string().optional(),
});
