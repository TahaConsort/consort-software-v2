import { z } from "zod";

/** Finance — request schemas (CRM_MASTER §5.11, RULE-FI). */

export const createInvoiceSchema = z.object({
  shipmentId: z.string().min(1, "shipmentId is required"),
  kind: z.enum(["receivable", "payable"]).default("receivable"),
  otdStepId: z.string().min(1).optional(),
  vendorId: z.string().min(1).optional(), // payable — the billed vendor (preferred over counterparty)
  counterparty: z.string().min(1).max(200).optional(),
  currency: z.string().length(3).optional(),
  dueDate: z.coerce.date().optional(),
  // Roadmap §6 — what this bill relates to, as foreign keys rather than free text in
  // the description: the B/L, the declaration, the instrument, the container.
  billOfLadingId: z.string().uuid().optional(),
  goodsDeclarationId: z.string().uuid().optional(),
  financialInstrumentId: z.string().uuid().optional(),
  containerId: z.string().uuid().optional(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1, "A line description is required"),
        quantity: z.coerce.number().positive().default(1),
        unitPrice: z.coerce.number().nonnegative("Unit price can't be negative"),
        // Roadmap §4.7 — a terminal bill is a list of named charges, each carrying 15%
        // Sindh Sales Tax. The tax AMOUNT is computed server-side from this rate.
        chargeCode: z.string().max(60).optional(),
        taxPercent: z.coerce.number().min(0).max(100).optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .min(1, "At least one charge line is required"),
});

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive("Payment amount must be positive"),
  method: z.enum(["bank_transfer", "cheque", "cash", "lc_settlement", "other"]),
  referenceNumber: z.string().optional(),
  fxRate: z.coerce.number().positive().optional(),
  receivedAt: z.coerce.date().optional(),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().min(3, "A void reason is required"),
});
