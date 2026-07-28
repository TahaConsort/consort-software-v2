import { z } from "zod";

/** Action Engine — read query schemas (CRM_MASTER §5.12). */

export const outboxQuerySchema = z.object({
  dispatched: z.enum(["true", "false"]).optional(), // filter by dispatch state
  eventType: z.string().max(80).optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});
