import { z } from "zod";

/** Job-charge ledger schemas (freight-forwarding OTC upgrade). */

export const createChargeSchema = z.object({
  shipmentId: z.string().min(1, "shipmentId is required"),
  otdStepId: z.string().min(1).optional(),
  chargeCode: z.string().min(1, "chargeCode is required").max(60),
  direction: z.enum(["receivable", "payable"]),
  vendorId: z.string().min(1).optional(), // required for payables
  description: z.string().max(300).optional(),
  currency: z.string().length(3).optional(),
  fxRate: z.coerce.number().positive().optional(),
  estimatedAmount: z.coerce.number().nonnegative("Amount cannot be negative"),
  actualAmount: z.coerce.number().nonnegative().optional(),
});

export const confirmChargeSchema = z.object({
  actualAmount: z.coerce.number().nonnegative("Amount cannot be negative"),
  vendorId: z.string().min(1).optional(),
  fxRate: z.coerce.number().positive().optional(),
});

export const cancelChargeSchema = z.object({
  reason: z.string().min(3, "A cancellation reason is required"),
});
