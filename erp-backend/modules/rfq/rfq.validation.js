import { z } from "zod";
import { RFQ_SERVICES, RFQ_LEGS } from "../../utils/serviceVendorTypes.js";

/**
 * Vendor RFQ schemas. Money is validated but never trusted for totals — the
 * controller recomputes every line amount and the quote total server-side, the
 * same way RULE-QT-02 governs the sell side.
 */

const quoteLineSchema = z.object({
  chargeCode: z.string().max(50).optional(),
  description: z.string().min(1, "Description is required").max(300),
  quantity: z.coerce.number().positive("Quantity must be greater than zero").default(1),
  unitPrice: z.coerce.number().min(0, "Rate cannot be negative"),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export const createRfqBatchSchema = z.object({
  queryId: z.string().uuid(),
  neededBy: z.coerce.date().optional(),
  notes: z.string().max(1000).optional(),
  requests: z
    .array(
      z.object({
        service: z.enum(RFQ_SERVICES),
        // Rail-mode transport only: which of the three legs this request prices.
        leg: z.enum(RFQ_LEGS).optional(),
        vendorIds: z.array(z.string().uuid()).min(1, "Pick at least one vendor"),
      }),
    )
    .min(1, "Pick at least one service to request rates for"),
});

export const addVendorsSchema = z.object({
  vendorIds: z.array(z.string().uuid()).min(1, "Pick at least one vendor"),
});

export const enterQuoteSchema = z.object({
  currency: z.string().length(3).optional(),
  validityDate: z.coerce.date().optional(),
  receivedAt: z.coerce.date().optional(),
  notes: z.string().max(1000).optional(),
  lines: z.array(quoteLineSchema).min(1, "A quote needs at least one charge line"),
});

export const cancelRfqSchema = z.object({
  reason: z.string().max(500).optional(),
});
