import { z } from "zod";

/**
 * Export trade documents — request schemas (roadmap §4).
 *
 * Two conventions carried from the rest of the codebase:
 *   · totals are never accepted from a client. Packing-list totals and invoice totals
 *     are recomputed server-side from their items/lines (ADR-001), so no schema here
 *     has a `totalValue` or `totalGrossWeightKg` field.
 *   · line collections are REPLACED wholesale rather than patched item by item, which
 *     is how the workflow module already handles a step's sub-action checklist.
 */

const money = z.number().nonnegative();
const currency = z.string().length(3, "Use a 3-letter currency code");
const shortText = z.string().min(1).max(200);
const notes = z.string().max(2000).nullable().optional();

// ── §4.1 Sales Contract / Proforma ───────────────────────────────────────────

export const createContractSchema = z.object({
  contractNo: shortText,
  contractDate: z.coerce.date().optional(),
  direction: z.enum(["export", "import"]).default("export"),
  vendorId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  incoterm: z.string().max(20).optional(),
  currency,
  totalValue: money.optional(),
  paymentTerms: z.string().max(500).optional(),
  productDescription: z.string().max(2000).optional(),
  notes,
});

export const updateContractSchema = createContractSchema
  .partial()
  .extend({ status: z.enum(["draft", "active", "completed", "cancelled"]).optional() })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to change" });

// ── §4.2 Financial Instrument (bank EXP registration) ────────────────────────

export const createFiSchema = z
  .object({
    fiNumber: shortText, // e.g. BIP-EXP-296937-14112025
    type: z.enum(["exp_form", "lc", "dp", "da", "advance", "open_account"]).default("exp_form"),
    contractId: z.string().uuid().optional(),
    vendorId: z.string().uuid(),
    bankVendorId: z.string().uuid(),
    customerId: z.string().uuid().optional(),
    buyerVendorId: z.string().uuid().optional(),
    incoterm: z.string().max(20).optional(),
    currency,
    value: z.number().positive("The instrument value must be greater than zero"),
    // "60% CAD / 40% DA 75 days from B/L date" as three fields.
    cadPercent: z.number().min(0).max(100).optional(),
    daPercent: z.number().min(0).max(100).optional(),
    daDays: z.number().int().min(0).max(365).optional(),
    paymentTermsText: z.string().max(500).optional(),
    portOfDischarge: z.string().max(100).optional(),
    issueDate: z.coerce.date().optional(),
    expiryDate: z.coerce.date(),
    notes,
  })
  .refine((d) => (d.cadPercent ?? 0) + (d.daPercent ?? 0) <= 100, {
    message: "CAD and DA percentages cannot add up to more than 100",
  })
  .refine((d) => !d.issueDate || d.expiryDate >= d.issueDate, {
    message: "The expiry date cannot be before the issue date",
  });

export const updateFiSchema = z
  .object({
    fiNumber: shortText.optional(),
    type: z.enum(["exp_form", "lc", "dp", "da", "advance", "open_account"]).optional(),
    contractId: z.string().uuid().nullable().optional(),
    bankVendorId: z.string().uuid().optional(),
    buyerVendorId: z.string().uuid().nullable().optional(),
    customerId: z.string().uuid().nullable().optional(),
    incoterm: z.string().max(20).nullable().optional(),
    value: z.number().positive().optional(),
    cadPercent: z.number().min(0).max(100).nullable().optional(),
    daPercent: z.number().min(0).max(100).nullable().optional(),
    daDays: z.number().int().min(0).max(365).nullable().optional(),
    paymentTermsText: z.string().max(500).nullable().optional(),
    portOfDischarge: z.string().max(100).nullable().optional(),
    issueDate: z.coerce.date().nullable().optional(),
    expiryDate: z.coerce.date().optional(),
    status: z.enum(["draft", "active", "expired", "cancelled"]).optional(), // `closed` goes through /close
    notes,
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to change" });

export const drawdownSchema = z.object({
  amount: z.number().positive("A drawdown must be greater than zero"),
  realisedAt: z.coerce.date(),
  shipmentId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  tradeInvoiceId: z.string().uuid().optional(),
  notes,
});

export const closeFiSchema = z.object({
  // Closing an instrument that is not fully drawn is legal but deliberate — the desk
  // says why, and the reason lands in the audit row.
  reason: z.string().min(3).max(500).optional(),
  force: z.boolean().optional(),
});

// ── §7 Containers ────────────────────────────────────────────────────────────

export const createContainerSchema = z.object({
  containerNo: z.string().min(4).max(20),
  sealNo: z.string().max(30).optional(),
  containerTypeCode: z.string().max(20).optional(),
  cartons: z.number().int().nonnegative().optional(),
  netWeightKg: money.optional(),
  grossWeightKg: money.optional(),
});

export const updateContainerSchema = createContainerSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to change" });

// ── §4.3 Packing List ────────────────────────────────────────────────────────

export const upsertPackingListSchema = z.object({
  containerId: z.string().uuid().nullable().optional(),
  issuedByVendorId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  listDate: z.coerce.date().optional(),
  notes,
});

export const packingListItemSchema = z.object({
  skuRef: z.string().max(60).optional(),
  description: shortText,
  hsCode: z.string().max(20).optional(),
  qtyPerBox: z.number().int().nonnegative().optional(),
  boxes: z.number().int().nonnegative().optional(),
  pieces: z.number().int().nonnegative().optional(),
  netWeightKg: money.optional(),
  grossWeightKg: money.optional(),
});

// The whole collection is replaced in one call, then the header totals are recomputed.
export const packingListItemsSchema = z.object({
  items: z.array(packingListItemSchema).max(500),
});

// ── §4.4 Commercial Invoice ──────────────────────────────────────────────────

export const createTradeInvoiceSchema = z.object({
  side: z.enum(["purchase", "sale"]),
  invoiceNo: shortText,
  invoiceDate: z.coerce.date(),
  financialInstrumentId: z.string().uuid().optional(),
  packingListId: z.string().uuid().optional(),
  sellerVendorId: z.string().uuid().optional(),
  buyerVendorId: z.string().uuid().optional(),
  sellerCustomerId: z.string().uuid().optional(),
  buyerCustomerId: z.string().uuid().optional(),
  bankVendorId: z.string().uuid().optional(),
  incoterm: z.string().max(20).optional(),
  shipmentTerms: z.string().max(200).optional(),
  rexNo: z.string().max(40).optional(),
  originStatement: z.string().max(500).optional(),
  currency,
  notes,
});

export const updateTradeInvoiceSchema = createTradeInvoiceSchema
  .omit({ side: true }) // the side decides who may write the row — never switched in place
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to change" });

export const tradeInvoiceLineSchema = z.object({
  packingListItemId: z.string().uuid().optional(),
  description: shortText,
  hsCode: z.string().max(20).optional(),
  quantity: z.number().positive(),
  unitOfMeasure: z.string().max(20).optional(),
  unitPrice: money,
});

export const tradeInvoiceLinesSchema = z.object({
  lines: z.array(tradeInvoiceLineSchema).max(500),
});

export const voidTradeInvoiceSchema = z.object({
  reason: z.string().min(3, "A void reason is required").max(500),
});

// ── §4.5 Bill of Lading ──────────────────────────────────────────────────────

export const upsertBolSchema = z.object({
  blNumber: shortText,
  bookingNo: z.string().max(60).nullable().optional(),
  blType: z.enum(["master", "house"]).optional(),
  carrierVendorId: z.string().uuid().nullable().optional(),
  carrierAgentVendorId: z.string().uuid().nullable().optional(),
  shipperText: z.string().max(500).nullable().optional(),
  consigneeText: z.string().max(500).nullable().optional(),
  notifyText: z.string().max(500).nullable().optional(),
  secondNotifyText: z.string().max(500).nullable().optional(),
  vesselName: z.string().max(120).nullable().optional(),
  voyageNo: z.string().max(60).nullable().optional(),
  portOfLoading: z.string().max(100).nullable().optional(),
  portOfDischarge: z.string().max(100).nullable().optional(),
  freightTerms: z.enum(["prepaid", "collect"]).nullable().optional(),
  shippedOnBoard: z.coerce.date().nullable().optional(),
  issueDate: z.coerce.date().nullable().optional(),
  netWeightKg: money.nullable().optional(),
  grossWeightKg: money.nullable().optional(),
  containerIds: z.array(z.string().uuid()).max(100).optional(),
  notes,
});

// ── §4.6 Goods Declaration (GD-I) ────────────────────────────────────────────

export const upsertGdSchema = z.object({
  gdNumber: shortText,
  gdDate: z.coerce.date().nullable().optional(),
  clearingAgentVendorId: z.string().uuid().nullable().optional(),
  financialInstrumentId: z.string().uuid().nullable().optional(),
  tradeInvoiceId: z.string().uuid().nullable().optional(),
  portOfShipment: z.string().max(100).nullable().optional(),
  portOfDischarge: z.string().max(100).nullable().optional(),
  // Customs values are PKR, converted from the invoice currency at this rate (§7.2).
  exchangeRate: z.number().positive().nullable().optional(),
  fobValuePkr: money.nullable().optional(),
  freightPkr: money.nullable().optional(),
  cfrValuePkr: money.nullable().optional(),
  insurancePkr: money.nullable().optional(),
  assessedValuePkr: money.nullable().optional(),
  appraiserName: z.string().max(120).nullable().optional(),
  examinerName: z.string().max(120).nullable().optional(),
  outOfChargeAt: z.coerce.date().nullable().optional(),
  filedAt: z.coerce.date().nullable().optional(),
  notes,
});

export const gdLineSchema = z.object({
  tradeInvoiceLineId: z.string().uuid().optional(),
  hsCode: z.string().min(4).max(20),
  description: shortText,
  quantity: z.number().positive(),
  unitValue: money.optional(),
  declaredValuePkr: money.optional(),
  assessedValuePkr: money.optional(),
  sroCode: z.string().max(40).optional(),
});

export const gdLinesSchema = z.object({
  lines: z.array(gdLineSchema).max(500),
});

// ── Trade shipment origination (roadmap Step 1, supersedes INV-03) ───────────

export const createTradeShipmentSchema = z.object({
  contractId: z.string().uuid(),
  financialInstrumentId: z.string().uuid().optional(),
  customerId: z.string().uuid(),
  services: z
    .array(
      z.enum([
        "local_transport",
        "customs_clearance",
        "sea_freight",
        "port_handling",
        "lc_finance",
        "destination_services",
      ]),
    )
    .min(1, "A shipment needs at least one service"),
  direction: z.enum(["export", "import"]).default("export"),
  originPort: z.string().max(20).optional(),
  destinationPort: z.string().max(20).optional(),
  incoterm: z.string().max(20).optional(),
  etd: z.coerce.date().optional(),
  eta: z.coerce.date().optional(),
});
