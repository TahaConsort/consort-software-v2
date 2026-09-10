import { z } from "zod";

/** Task — request schemas (RULE-TK). */

export const completeTaskSchema = z.object({
});

export const reassignTaskSchema = z.object({
  assigneeId: z.string().min(1, "assigneeId is required"),
});
