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
  lines: z
    .array(
      z.object({
        description: z.string().min(1, "A line description is required"),
        quantity: z.coerce.number().positive().default(1),
        unitPrice: z.coerce.number().nonnegative("Unit price can't be negative"),
        sortOrder: z.number().int().optional(),
      }),
    )
    .min(1, "At least one charge line is required"),
});

// Draft an invoice from existing job-charges (freight-forwarding OTC upgrade).
export const invoiceFromChargesSchema = z.object({
  shipmentId: z.string().min(1, "shipmentId is required"),
  direction: z.enum(["receivable", "payable"]),
  chargeIds: z.array(z.string().min(1)).min(1, "Select at least one charge to bill"),
  vendorId: z.string().min(1).optional(), // required for payables (all charges must share it)
  currency: z.string().length(3).optional(),
  dueDate: z.coerce.date().optional(),
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
