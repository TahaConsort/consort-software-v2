import { z } from "zod";

/** Audit — filter query schema (CRM_MASTER §5.19). */
export const auditQuerySchema = z.object({
  actorId: z.string().optional(),
  resourceType: z.string().max(40).optional(),
  resourceId: z.string().optional(),
  action: z.string().max(80).optional(), // prefix/contains match
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});
