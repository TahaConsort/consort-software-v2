import { z } from "zod";
import { MAX_TTL_DAYS } from "./approval.service.js";

/**
 * Approval-link request schemas.
 *
 * The public decision schema is the only place an anonymous caller reaches a write, so
 * it is deliberately tight: a closed decision enum, a required identity, and hard
 * length caps on every free-text field.
 */

export const issueLinkSchema = z.object({
  expiresInDays: z.coerce.number().int().min(1).max(MAX_TTL_DAYS).optional(),
});

// Sales records the customer's verbal yes and how it arrived (ADR-056). The link is
// minted in the same call, so the TTL option rides along.
export const acceptanceSchema = z.object({
  via: z.enum(["email", "phone", "whatsapp", "in_person"]),
  note: z.string().trim().max(500).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(MAX_TTL_DAYS).optional(),
});

export const publicDecisionSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    // Who is accepting on the customer's side. Self-declared, but recorded with the
    // request's IP and user agent — the evidence an internal click never leaves.
    approverName: z.string().trim().min(2, "Enter your name").max(120),
    approverEmail: z.string().trim().email("Enter a valid email address").max(200),
    reason: z.string().trim().max(1000).optional(),
  })
  // Rejecting without saying why leaves Ops nothing to revise against (RULE-QT-04).
  .refine((d) => d.decision !== "rejected" || (d.reason ?? "").length >= 3, {
    path: ["reason"],
    message: "Tell us what needs to change so we can send a revised quote",
  });
