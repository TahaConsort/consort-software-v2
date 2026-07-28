import { z } from "zod";

/** Reports — query schemas (CRM_MASTER §5.18). Optional date window + format. */
export const reportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(["json", "csv", "xlsx", "pdf"]).optional(),
});
