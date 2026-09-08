import { z } from "zod";
import { SERVICE_CODES } from "../../utils/serviceCodes.js";

/**
 * Public storefront schemas (CRM_MASTER §5.20). The endpoint is anonymous, so
 * validation is the first line of defence.
 */

export const rateQuoteSchema = z.object({
  services: z.array(z.enum(SERVICE_CODES)).min(1, "Select at least one service"),
  originPort: z.string().optional(),
  destinationPort: z.string().optional(),
  containerTypeCode: z.string().optional(),
  weightKg: z.coerce.number().positive().max(1_000_000).optional(),
});
