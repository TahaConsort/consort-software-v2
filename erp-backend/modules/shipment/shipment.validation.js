import { z } from "zod";
import { PARTY_ROLES } from "../../utils/partyRoles.js";

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

// Management hands a shipment to another ops person, or releases it back to the
// claimable pool with an explicit null. `null` must be spelled out rather than
// omitted, so a malformed body can never silently unassign a live job.
export const assignShipmentSchema = z.object({
  ownerId: z.string().uuid().nullable(),
});

// Link the roadmap's Step 1 registers to a shipment (ADR-057): a Trade Contract and/or a
// Financial Instrument. A quotation-born shipment has neither at birth, and the step
// cannot complete until both are on it.
// ── Per-shipment party roles (Export Shipment Workflow roadmap §2/§7) ─────────
// A party row points at exactly one party record — a `vendors` row (the party
// directory, which already carries NTN/STRN/REX/VAT/IBAN/SWIFT) or a CRM `customers`
// row acting as a party on its own shipment. Mirrors the shipment_parties_one_target
// CHECK in prisma/sql/constraints.sql; keep the two in step.
//
// The role is NOT validated against the party's `Vendor.type`. That is the whole point
// of the junction: PARTY_ROLE_VENDOR_TYPES only orders the picker.
export const addPartySchema = z
  .object({
    role: z.enum(PARTY_ROLES),
    vendorId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((d) => (d.vendorId ? 1 : 0) + (d.customerId ? 1 : 0) === 1, {
    message: "Provide exactly one of vendorId or customerId",
  });

export const updatePartySchema = z
  .object({
    role: z.enum(PARTY_ROLES).optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((d) => d.role !== undefined || d.notes !== undefined, {
    message: "Provide a role and/or notes to change",
  });
