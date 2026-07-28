import { z } from "zod";

/**
 * Company, Contact & Customer — request schemas (CRM_MASTER §5.3).
 * Customers are NEVER created here — only lead conversion creates one
 * (RULE-LD-05); this module edits/reads them and provisions portal users.
 */

const email = z
  .string()
  .email("Invalid email address")
  .transform((v) => v.toLowerCase());

export const createCompanySchema = z.object({
  name: z.string().min(2, "Company name is required"),
  country: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
});

export const updateCompanySchema = createCompanySchema.partial();

export const createContactSchema = z.object({
  name: z.string().min(1, "Contact name is required"),
  email: email.optional(),
  phone: z.string().optional(),
  position: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

export const updateContactSchema = createContactSchema.partial();

export const updateCustomerSchema = z.object({
  assignedBdoId: z.string().min(1).optional().nullable(),
  creditLimit: z.coerce.number().nonnegative().optional().nullable(),
  creditTermsDays: z.coerce.number().int().nonnegative().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const portalUserSchema = z.object({
  email,
});
