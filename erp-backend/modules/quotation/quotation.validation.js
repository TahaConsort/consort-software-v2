import { z } from "zod";
import { SERVICE_CODES } from "../../utils/servicePackage.js";

/**
 * Quotation — request schemas (CRM_MASTER §5.7, RULE-QT).
 * Charge-line totals are computed SERVER-SIDE; any client-supplied total is
 * ignored (RULE-QT-02). A revision is a new row, never a status (ADR-019).
 */

const chargeLineSchema = z.object({
  service: z.enum(SERVICE_CODES).optional(),
  // Cost sheet (freight-forwarding OTC upgrade) — internal only.
  chargeCode: z.string().max(60).optional(), // ChargeType.code — drives charge seeding + step mapping
  costAmount: z.coerce.number().nonnegative("Cost cannot be negative").optional(), // buy price
  costVendorId: z.string().min(1).optional(), // planned vendor hint
  description: z.string().min(1, "Charge line needs a description"),
  quantity: z.coerce.number().positive().default(1),
  unitPrice: z.coerce.number().nonnegative("Unit price cannot be negative"),
  sortOrder: z.coerce.number().int().optional(),
});

export const createQuotationSchema = z.object({
  queryId: z.string().min(1, "queryId is required"),
  currency: z.string().length(3).optional(),
  fxRate: z.coerce.number().positive().optional(),
  validityDate: z.coerce.date().optional(),
  chargeLines: z.array(chargeLineSchema).min(1, "At least one charge line is required"),
});

export const updateQuotationSchema = z.object({
  currency: z.string().length(3).optional(),
  fxRate: z.coerce.number().positive().optional(),
  validityDate: z.coerce.date().optional(),
  chargeLines: z.array(chargeLineSchema).min(1).optional(),
});

export const approveQuotationSchema = z.object({
  rowVersion: z.coerce.number().int().optional(), // optimistic concurrency (RULE-QT-08)
});

export const rejectQuotationSchema = z.object({
  reason: z.string().min(3, "A rejection reason is required (RULE-QT-04)"),
});
