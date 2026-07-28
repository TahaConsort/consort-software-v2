import { z } from "zod";

/** Documents — request schemas (CRM_MASTER §5.13, RULE-DOC). */

const OWNER_TYPES = ["shipment", "quotation", "query", "lead", "customer", "task", "chat_message"];

// The closed document-type vocabulary. Gate-relevant types (RULE-SH-06) must be
// deliberate choices, not free text — a typo'd or mislabelled docType would
// either fail to satisfy a step gate or falsely satisfy one.
export const DOC_TYPES = [
  "gd",
  "bol",
  "pod",
  "invoice",
  "packing_list",
  "commercial_invoice",
  "sales_tax_invoice",
  "certificate_of_origin",
  "authority_letterhead",
  "undertaking", // customer's undertaking letter — part of the export order-confirmation pack
  "quotation", // the approved quotation, auto-rendered onto the shipment at approval (ADR-048)
  "lc",
  "cro",
  "inspection_cert",
  "bank_receipt",
  "telex",
  "eir_out", // empty-container pickup EIR
  "eir_in", // port gate-in EIR
  "eir_pickup", // destination pickup EIR
  "eir_empty_return", // empty-container return EIR
  "delivery_order",
  "gate_pass",
  "proof", // evidence attached to a specific step (pickup photo, gate pass, …)
  "other",
];

// Multipart body (parsed alongside the file). docType is the legal/document kind
// that drives the RULE-SH-06 required-doc gate. otdStepId optionally groups the
// file under a specific shipment step (proofs, step uploads).
export const uploadSchema = z.object({
  ownerType: z.enum(OWNER_TYPES),
  ownerId: z.string().min(1, "ownerId is required"),
  docType: z.enum(DOC_TYPES).optional(),
  otdStepId: z.string().min(1).optional(),
});

export const listQuerySchema = z.object({
  ownerType: z.enum(OWNER_TYPES),
  ownerId: z.string().min(1),
});

export const deleteSchema = z.object({
  reason: z.string().max(300).optional(),
});
