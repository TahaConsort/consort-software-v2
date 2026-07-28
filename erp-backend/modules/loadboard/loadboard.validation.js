import { z } from "zod";
import { SERVICE_CODES } from "../query/query.validation.js";

/**
 * Load board posting schemas (CRM_MASTER §5.20). Curated by Operations/Transport.
 */

export const TRANSPORT_MODES = ["sea", "road", "air", "rail"];
export const LOAD_BOARD_STATUSES = ["open", "booked", "expired"];

export const createPostingSchema = z.object({
  mode: z.enum(TRANSPORT_MODES),
  originPort: z.string().min(1, "Origin is required"),
  destinationPort: z.string().min(1, "Destination is required"),
  containerTypeCode: z.string().optional(),
  equipment: z.string().optional(),
  capacity: z.coerce.number().int().positive().optional(),
  departureDate: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  transitDays: z.coerce.number().int().positive().optional(),
  indicativeRate: z.coerce.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  services: z.array(z.enum(SERVICE_CODES)).optional(),
  notes: z.string().optional(),
});

export const updatePostingSchema = createPostingSchema.partial().extend({
  status: z.enum(LOAD_BOARD_STATUSES).optional(),
  isActive: z.boolean().optional(),
});
