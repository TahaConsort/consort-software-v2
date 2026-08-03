import { z } from "zod";

/** Documents — request schemas (CRM_MASTER §5.13, RULE-DOC). */

// `vendor`, `driver` and `vehicle` are master-data owners: the compliance paperwork
// that proves a counterparty or an asset may move cargo (CNIC, licence, registration).
// Internal-only — a portal customer is denied them in `ownerInScope`.
const OWNER_TYPES = [
  "shipment", "quotation", "query", "lead", "customer", "task", "chat_message",
  "vendor", "driver", "vehicle",
  "lc_referral", // the bank's SWIFT advice — the source document a query is built from
];

// The document-type vocabulary lives in the `document_types` table since ADR-051
// (admin-managed; uploads are checked against ACTIVE rows in the controller via
// docTypes.cache.js). The list below is the FACTORY vocabulary: prisma/seed.js seeds
// the table from it, and docTypeLabel() falls back to it for labels when a row
// predates the table. Gate-relevant types (RULE-SH-06) must be deliberate choices,
// not free text — a typo'd or mislabelled docType would either fail to satisfy a
// step gate or falsely satisfy one; that guarantee now comes from the DB lookup.
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
  "rate_confirmation", // RC — the signed rate the order is locked against (gates order_lock)
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
  // Master-data paperwork — vendors, drivers and own vehicles
  "cnic", // national ID card scan (driver)
  "driving_license",
  "vehicle_registration", // registration book / number plate document
  "route_permit",
  "insurance",
  "tax_certificate", // vendor NTN/STRN certificate
  "other",
];

/**
 * Human labels for the vocabulary above. The step gate names missing documents back
 * to whoever owns the step, and "rate_confirmation" is a database code, not language
 * — this is what turns it into "Rate Confirmation (RC)". Mirrors DOC_TYPE_OPTIONS in
 * erp-frontend/src/services/documentService.js.
 */
export const DOC_TYPE_LABELS = {
  gd: "GD / Customs Declaration",
  bol: "Bill of Lading (BOL)",
  pod: "Proof of Delivery (POD)",
  invoice: "Invoice",
  packing_list: "Packing List",
  commercial_invoice: "Commercial Invoice",
  sales_tax_invoice: "Sales Tax Invoice",
  certificate_of_origin: "Certificate of Origin",
  authority_letterhead: "Authority Letterhead",
  undertaking: "Undertaking",
  quotation: "Quotation",
  rate_confirmation: "Rate Confirmation (RC)",
  lc: "Letter of Credit / SWIFT Advice",
  cro: "Container Release Order (CRO)",
  inspection_cert: "Inspection & Seal Certificate",
  bank_receipt: "Bank Submission Receipt",
  telex: "Telex Release Confirmation",
  eir_out: "EIR — Empty Container Pickup",
  eir_in: "EIR — Port Gate-In",
  eir_pickup: "EIR — Destination Pickup",
  eir_empty_return: "EIR — Empty Return",
  delivery_order: "Delivery Order (DO)",
  gate_pass: "Gate Pass",
  proof: "Proof / Evidence",
  cnic: "CNIC (National ID)",
  driving_license: "Driving Licence",
  vehicle_registration: "Vehicle Registration",
  route_permit: "Route Permit",
  insurance: "Insurance Certificate",
  tax_certificate: "Tax Certificate (NTN/STRN)",
  other: "Other",
};

// Falls back to a de-underscored code so an unlabelled type never renders raw.
export const docTypeLabel = (code) =>
  DOC_TYPE_LABELS[code] ?? String(code ?? "").replace(/_/g, " ");

// Multipart body (parsed alongside the file). docType is the legal/document kind
// that drives the RULE-SH-06 required-doc gate. otdStepId optionally groups the
// file under a specific shipment step (proofs, step uploads).
//
// docType is format-checked here and EXISTENCE-checked in the controller against the
// document_types table (ADR-051) — Zod is sync, the table lookup is not.
export const uploadSchema = z.object({
  ownerType: z.enum(OWNER_TYPES),
  ownerId: z.string().min(1, "ownerId is required"),
  docType: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,49}$/, "Unknown document type")
    .optional(),
  otdStepId: z.string().min(1).optional(),
});

export const listQuerySchema = z.object({
  ownerType: z.enum(OWNER_TYPES),
  ownerId: z.string().min(1),
});

export const deleteSchema = z.object({
  reason: z.string().max(300).optional(),
});
