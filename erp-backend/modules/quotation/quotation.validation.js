import { z } from "zod";
import { SERVICE_CODES } from "../../utils/serviceCodes.js";

/**
 * Quotation — request schemas (CRM_MASTER §5.7, RULE-QT).
 * Charge-line totals are computed SERVER-SIDE; any client-supplied total is
 * ignored (RULE-QT-02). A revision is a new row, never a status (ADR-019).
 */

const chargeLineSchema = z.object({
  /**
   * NOT validated against the service catalog, deliberately.
   *
   * A Query's `services` is FREE TEXT — the catalog is the suggested list, and anything
   * typed into "Other service" rides along with it (query.validation.js). The quote
   * sheet builds one charge line per service, so a hand-typed service arrives here as a
   * plain string: "Destination Services / Agent", "warehousing", whatever the customer
   * asked for. Validating it as an enum meant a query with any free-text service simply
   * could not be quoted — the whole request 400'd on a field that is only a reporting
   * tag.
   *
   * `quotation_charge_lines.service` is the ServiceCode enum column, used to categorise
   * a line for reporting, so a value outside the catalog is DROPPED rather than
   * rejected. Nothing is lost: the line still prices, and its description carries what
   * was actually asked for.
   */
  service: z
    .string()
    .max(120)
    .nullish()
    .transform((v) => (v && SERVICE_CODES.includes(v) ? v : undefined)),
  // Cost sheet (freight-forwarding OTC upgrade) — internal only.
  chargeCode: z.string().max(60).optional(), // ChargeType.code — categorises the line for reporting
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

// BDO gives the sent quote to the customer over mail/phone/WhatsApp and records how.
export const shareQuotationSchema = z.object({
  channel: z.enum(["email", "phone", "whatsapp", "in_person"]),
  note: z.string().max(500).optional(),
});
