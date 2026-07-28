import { z } from "zod";

/** Task — request schemas (RULE-TK). */

export const completeTaskSchema = z.object({
  forceReason: z.string().min(3).optional(), // forwarded when completing an out-of-order OTD step
});

export const reassignTaskSchema = z.object({
  assigneeId: z.string().min(1, "assigneeId is required"),
});
