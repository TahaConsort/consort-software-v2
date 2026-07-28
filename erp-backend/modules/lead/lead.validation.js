import { z } from "zod";

/**
 * Lead Management — request schemas (CRM_MASTER §5.4, RULE-LD, ADR-042).
 * Outreach logging lives here because the lead machine cannot advance
 * without it (RULE-LD-02, WORKFLOW §2).
 */

// LeadSource is set automatically by the intake channel, never chosen manually
// (ADR-042 — immutable, INV-13): a lead created here is always `bdo`; `direct`
// comes from a storefront inquiry conversion and `bank_lc` from the LC webhook.
const OUTREACH_TYPES = ["call", "email", "meeting", "whatsapp", "linkedin", "site_visit"];
const OUTREACH_OUTCOMES = ["positive", "neutral", "negative", "no_response"];

const inlineCompany = z.object({
  name: z.string().min(2, "Company name is required"),
  country: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
});

const inlineContact = z.object({
  name: z.string().min(1, "Contact name is required"),
  email: z.string().email("Invalid email address").transform((v) => v.toLowerCase()).optional(),
  phone: z.string().optional(),
  position: z.string().optional(),
});

// Company and contact are created ONCE, at lead time (RULE-LD-01) —
// pass an existing id or the inline object, never neither.
export const createLeadSchema = z
  .object({
    companyId: z.string().min(1).optional(),
    company: inlineCompany.optional(),
    contactId: z.string().min(1).optional(),
    contact: inlineContact.optional(),
    ownerId: z.string().min(1).optional(), // ASM/Management may assign; defaults to creator
  })
  .refine((d) => d.companyId || d.company, { message: "companyId or company is required" })
  .refine((d) => d.contactId || d.contact, { message: "contactId or contact is required" });

// Editable basics — never source (INV-13), never status (machine-only).
export const updateLeadSchema = z.object({
  ownerId: z.string().min(1).optional(),
  contactId: z.string().min(1).optional(),
});

// Manual transitions (WORKFLOW §2). `converted` is only reachable via /convert.
export const transitionSchema = z
  .object({
    toStatus: z.enum(["contacted", "qualified", "lost"]),
    reason: z.string().min(3).optional(),
    notes: z.string().optional(),
  })
  .refine((d) => d.toStatus !== "lost" || !!d.reason, {
    message: "lostReason is required when marking a lead lost (RULE-LD-06)",
  });

// lost → contacted requires a reason (RULE-LD-04).
export const reopenSchema = z.object({
  reason: z.string().min(3, "A reopen reason is required"),
});

export const outreachSchema = z.object({
  type: z.enum(OUTREACH_TYPES),
  outcome: z.enum(OUTREACH_OUTCOMES),
  notes: z.string().optional(),
  durationMin: z.coerce.number().int().positive().optional(),
  occurredAt: z.coerce.date().optional(),
  followUpAt: z.coerce.date().optional(),
});
