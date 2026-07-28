import { z } from "zod";
import { SERVICE_CODES } from "../query/query.validation.js";

/**
 * Public storefront schemas (CRM_MASTER §5.20). These endpoints are anonymous,
 * so validation is the first line of defence; `website` is a honeypot field.
 */

export const rateQuoteSchema = z.object({
  services: z.array(z.enum(SERVICE_CODES)).min(1, "Select at least one service"),
  originPort: z.string().optional(),
  destinationPort: z.string().optional(),
  containerTypeCode: z.string().optional(),
  weightKg: z.coerce.number().positive().max(1_000_000).optional(),
});

export const inquirySchema = z.object({
  contactName: z.string().min(2, "Your name is required").max(120),
  contactEmail: z.string().email("A valid email is required").max(200),
  contactPhone: z.string().max(40).optional(),
  companyName: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  services: z.array(z.enum(SERVICE_CODES)).min(1, "Select at least one service"),
  originPort: z.string().max(20).optional(),
  destinationPort: z.string().max(20).optional(),
  containerTypeCode: z.string().max(20).optional(),
  incoterm: z.string().max(20).optional(),
  cargoDescription: z.string().max(500).optional(),
  weightKg: z.coerce.number().positive().max(1_000_000).optional(),
  isHazardous: z.boolean().optional(),
  isReefer: z.boolean().optional(),
  estimatedAmount: z.coerce.number().nonnegative().optional(),
  estimateCurrency: z.string().length(3).optional(),
  loadBoardPostingId: z.string().optional(),
  website: z.string().optional(), // honeypot — must stay empty
});
