/**
 * Add the master-data document vocabulary (CNIC, driving licence, vehicle
 * registration …) to `document_types` (ADR-051).
 *
 *   node scripts/seedMasterDataDocTypes.js
 *
 * Idempotent upsert of SIX rows and nothing else — deliberately not `prisma/seed.js`,
 * which rebuilds the step catalog and would be the wrong tool against a database
 * carrying live demo data. Existing rows keep their `customerUploadable` and `active`
 * flags; only the label is restated. None of these are portal-uploadable: a customer
 * has no business sending us a driver's ID card.
 */
import prisma from "../config/prisma.js";

const TYPES = [
  { code: "cnic", label: "CNIC (National ID)" },
  { code: "driving_license", label: "Driving Licence" },
  { code: "vehicle_registration", label: "Vehicle Registration" },
  { code: "route_permit", label: "Route Permit" },
  { code: "insurance", label: "Insurance Certificate" },
  { code: "tax_certificate", label: "Tax Certificate (NTN/STRN)" },
];

// Past the factory block (25 types × 10) so the pickers list them after the trade
// documents, where a rarely-used vocabulary belongs.
const SORT_BASE = 500;

async function run() {
  let created = 0;
  let updated = 0;

  for (const [i, t] of TYPES.entries()) {
    const existing = await prisma.documentType.findUnique({ where: { code: t.code } });
    await prisma.documentType.upsert({
      where: { code: t.code },
      update: { label: t.label },
      create: {
        code: t.code,
        label: t.label,
        customerUploadable: false,
        active: true,
        sortOrder: SORT_BASE + (i + 1) * 10,
      },
    });
    if (existing) updated += 1;
    else created += 1;
  }

  console.log(`✓ document types — ${created} created, ${updated} already present (labels restated)`);
}

run()
  .catch((err) => {
    console.error("✗ failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
