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
  "other",
];

export const createVendorSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  type: z.enum(VENDOR_TYPES),
  contactName: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  country: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  taxId: z.string().max(50).optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  currency: z.string().length(3).optional(),
  notes: z.string().max(1000).optional(),
});

export const updateVendorSchema = createVendorSchema.partial().extend({
  isActive: z.boolean().optional(),
});
