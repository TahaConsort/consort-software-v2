import { z } from "zod";

/**
 * Authentication & Access — request schemas (CRM_MASTER §5.1).
 * Password policy: min 8 chars (ADR-009 hardening over the old 6).
 */

const password = z.string().min(8, "Password must be at least 8 characters");
const email = z
  .string()
  .email("Invalid email address")
  .transform((v) => v.toLowerCase());

// Management tier + hr may be bootstrapped as the first login (DATABASE §8).
const bootstrapRoles = ["ceo", "project_director", "director", "cfo", "gm", "hr"];

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required"),
});

export const activateSchema = z.object({
  token: z.string().min(10, "Invalid activation token"),
  password,
});

export const forgotPasswordSchema = z.object({
  email,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10, "Invalid reset token"),
  password,
});

/**
 * Customer self-registration (CRM_MASTER §5.20/§5.16) — the storefront's
 * "Get a quote" gate. Creates the company + contact + customer + portal login
 * in one act, so the visitor lands in their own portal ready to be quoted.
 */
export const registerSchema = z.object({
  // Person
  contactName: z.string().min(2, "Your full name is required").max(120),
  email,
  password,
  phone: z.string().min(6, "A contact phone number is required").max(40),
  position: z.string().max(120).optional(),
  // Company
  companyName: z.string().min(2, "Company name is required").max(200),
  country: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  address: z.string().max(300).optional(),
  industry: z.string().max(120).optional(),
  website: z.string().max(200).optional(),
  // Honeypot — must stay empty (bots fill every field).
  fax: z.string().optional(),
});

export const bootstrapAdminSchema = z.object({
  email,
  password,
  role: z.enum(bootstrapRoles).default("ceo"),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
});
