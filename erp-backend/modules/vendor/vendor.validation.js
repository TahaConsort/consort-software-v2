import { z } from "zod";

/**
 * Vendor master schemas (freight-forwarding OTC upgrade). Vendors are the
 * counterparties on payable charges/invoices (transporters, shipping lines,
 * container yards, customs & destination agents, port terminals).
 */

export const VENDOR_TYPES = [
  "transporter",
  "shipping_line",
  "container_yard",
  "customs_agent",
  "destination_agent",
  "port_terminal",
  "rail_operator",
  "freight_forwarder",
  "ocean_carrier",
  "exporter",
  "buyer",
  "bank",
  "driver",
  "other",
];

export const createVendorSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  type: z.enum(VENDOR_TYPES),
  contactName: z.string().max(200).optional(),
  // Required on every vendor: the roadmap's whole directory premise is that a shipment
  // links to a party instead of re-typing how to reach it, and a party nobody can email
  // or call is not reachable. `.min(1)` on top of `.email()` so an empty string is
  // rejected with the missing-field message rather than a format one.
  email: z.string({ error: "Email is required" }).min(1, "Email is required").email("Enter a valid email address").max(200),
  phone: z.string({ error: "Phone number is required" }).min(1, "Phone number is required").max(50),
  address: z.string().max(500).optional(),
  country: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  taxId: z.string().max(50).optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  currency: z.string().length(3).optional(),
  strn: z.string().max(50).optional(),
  rexNo: z.string().max(50).optional(),
  vatNo: z.string().max(50).optional(),
  bankName: z.string().max(100).optional(),
  bankBranch: z.string().max(100).optional(),
  iban: z.string().max(50).optional(),
  swiftCode: z.string().max(11).optional(),
  accountTitle: z.string().max(100).optional(),
  website: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

export const updateVendorSchema = createVendorSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/** Optional note the requester adds to the rate-request email. */
export const vendorQuoteRequestSchema = z.object({
  message: z.string().max(2000).optional(),
});
