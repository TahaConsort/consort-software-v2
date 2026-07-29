import { z } from "zod";

/** Shipment — request schemas (CRM_MASTER §5.8, RULE-SH). OTD step schemas live
 *  in the OTD module (§5.9). */

export const holdSchema = z.object({
  type: z.enum([
    "customs_hold",
    "payment_hold",
    "documentation_hold",
    "weather_hold",
    "customer_request",
    "other",
  ]),
  reason: z.string().min(3, "A hold reason is required"),
});

export const resumeSchema = z.object({
  resolutionNotes: z.string().min(3, "Resolution notes are required"),
});

export const cancelSchema = z.object({
  reason: z.string().min(3, "A cancellation reason is required"),
});

// ETD/ETA — feeds the nightly ETA-breach sweep (WORKFLOW §14) and the tracking
// views. At least one of the two must be supplied.
export const scheduleSchema = z
  .object({
    etd: z.coerce.date().optional(),
    eta: z.coerce.date().optional(),
  })
  .refine((d) => d.etd || d.eta, { message: "Provide an ETD and/or an ETA" })
  .refine((d) => !d.etd || !d.eta || d.eta >= d.etd, { message: "ETA cannot be before ETD" });
