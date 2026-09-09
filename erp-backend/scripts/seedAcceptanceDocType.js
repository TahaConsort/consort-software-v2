/**
 * Land the verification-gated document types on a LIVE database (ADR-056).
 *
 *   node scripts/seedAcceptanceDocType.js
 *
 * `prisma/seed.js --templates-only` would do this too, but since ADR-051 that flag
 * REPLACES the admin-edited step catalog, so it must not be run against a database
 * with live workflow edits. This is the additive alternative: two upserts, idempotent,
 * nothing else touched.
 *
 *   quotation_acceptance   the customer's signed quotation — the paper door to approval
 *   rate_confirmation      the signed RC on Order Lock — restated because the seed used to
 *                          omit `requiresVerification` on update, which left the gate off
 */
import prisma from "../config/prisma.js";

const ROWS = [
  { code: "quotation_acceptance", label: "Signed Quotation Acceptance", customerUploadable: true, requiresVerification: true, sortOrder: 115 },
  { code: "rate_confirmation", label: "Rate Confirmation (RC)", customerUploadable: true, requiresVerification: true, sortOrder: 120 },
];

for (const t of ROWS) {
  const row = await prisma.documentType.upsert({
    where: { code: t.code },
    update: { label: t.label, customerUploadable: t.customerUploadable, requiresVerification: t.requiresVerification, active: true },
    create: { ...t, active: true },
  });
  console.log(`✓ ${row.code} — customerUploadable=${row.customerUploadable} requiresVerification=${row.requiresVerification} active=${row.active}`);
}

await prisma.$disconnect();
