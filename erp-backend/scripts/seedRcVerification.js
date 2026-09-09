/**
 * Turn on the Rate Confirmation gate (2026-09-08).
 *
 *   node scripts/seedRcVerification.js
 *
 * Idempotent upsert against `document_types`, in the same shape as
 * scripts/seedMasterDataDocTypes.js — run it instead of `prisma/seed.js
 * --templates-only --factory-reset`, which would replace the whole admin-curated
 * step catalog.
 *
 * What it changes, and why:
 *
 *   requiresVerification  A `rate_confirmation` document now counts towards the
 *                         Order Lock step only once Operations has verified it.
 *                         Before this, the RC that the system itself generates at
 *                         quote approval satisfied the gate on arrival, so "the order
 *                         locks against a signed RC" was never actually enforced.
 *
 *   customerUploadable    The customer has to be able to send the signed copy back.
 *                         Without this the portal upload picker refuses the type.
 *
 * Safe to re-run: it reports what changed and leaves everything else alone.
 */
import prisma from "../config/prisma.js";

const TARGET = {
  code: "rate_confirmation",
  label: "Rate Confirmation (RC)",
  customerUploadable: true,
  requiresVerification: true,
};

const run = async () => {
  const before = await prisma.documentType.findUnique({ where: { code: TARGET.code } });

  const row = await prisma.documentType.upsert({
    where: { code: TARGET.code },
    create: { ...TARGET, active: true, sortOrder: before?.sortOrder ?? 120 },
    update: {
      customerUploadable: TARGET.customerUploadable,
      requiresVerification: TARGET.requiresVerification,
    },
  });

  const changed =
    !before ||
    before.customerUploadable !== row.customerUploadable ||
    before.requiresVerification !== row.requiresVerification;

  console.log(
    changed
      ? `✓ ${row.code}: customerUploadable=${row.customerUploadable}, requiresVerification=${row.requiresVerification} (was ` +
        `${before ? `${before.customerUploadable}/${before.requiresVerification}` : "absent"})`
      : `· ${row.code} already correct — nothing to do`,
  );

  // Anything already on file stays `unverified`, which is the point: an existing
  // shipment sitting on Order Lock now waits for a signed copy to be verified.
  const pending = await prisma.document.count({
    where: { docType: TARGET.code, deletedAt: null, verificationStatus: "unverified" },
  });
  if (pending) {
    console.log(
      `  note: ${pending} existing rate_confirmation document(s) are unverified — the shipments ` +
      `they belong to will not pass Order Lock until ops verifies a signed copy.`,
    );
  }
};

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
