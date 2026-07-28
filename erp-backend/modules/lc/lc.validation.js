import { z } from "zod";

/**
 * Bank LC intake schemas (CRM_MASTER §5.21, WORKFLOW §2c). The webhook body is
 * validated in-controller (via safeParse) so the full raw payload is retained
 * for audit even when it carries fields we don't model.
 */

export const webhookLcSchema = z.object({
  lcNumber: z.string().min(1, "lcNumber is required").max(120),
  idempotencyKey: z.string().max(200).optional(), // bank's own message ref, if any
  messageRef: z.string().max(200).optional(),
  bankName: z.string().max(200).optional(),
  bankRef: z.string().max(200).optional(),
  applicantName: z.string().max(200).optional(),
  applicantEmail: z.string().email().max(200).optional(),
  applicantPhone: z.string().max(40).optional(),
  companyName: z.string().max(200).optional(),
  beneficiaryName: z.string().max(200).optional(),
  amount: z.coerce.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  originPort: z.string().max(20).optional(),
  destinationPort: z.string().max(20).optional(),
  commodity: z.string().max(500).optional(),
  incoterm: z.string().max(20).optional(),
  issueDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  services: z.array(z.string()).optional(),
});

export const updateLcStatusSchema = z.object({
  status: z.enum(["reviewing"]),
});

export const rejectLcSchema = z.object({
  reason: z.string().min(3, "A reason is required"),
});

// Convert → customer(bank_lc) + query. Optional owner + service overrides.
export const convertLcSchema = z.object({
  ownerId: z.string().optional(),
  services: z.array(z.enum(["local_transport", "customs_clearance", "sea_freight", "port_handling", "lc_finance", "destination_services"])).optional(),
});
