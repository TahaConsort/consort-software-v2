/**
 * One-shot backfill: give every pre-package Query / Quotation / Shipment a
 * `servicePackage` and a consistent `croHandledBy`, inferred from its frozen
 * `services[]` snapshot.
 *
 * Why this is needed: composition has no null-package escape hatch (a skipped package
 * gate would make the local trucking leg apply to every shipment), so nothing should
 * be left null. Existing SHIPMENTS are unaffected either way — their `otd_steps` rows
 * were materialised at approval and are never recomposed — but a Query or a sent
 * Quotation still awaiting approval genuinely needs one.
 *
 * Idempotent: only touches rows where service_package IS NULL. Safe to re-run.
 *
 *   node scripts/backfillServicePackages.js            # report only
 *   node scripts/backfillServicePackages.js --apply    # write
 */
import prisma from "../config/prisma.js";
import { inferPackageFromServices, resolveCroMode } from "../utils/servicePackage.js";

const APPLY = process.argv.includes("--apply");

const MODELS = [
  { name: "queries", delegate: prisma.query },
  { name: "quotations", delegate: prisma.quotation },
  { name: "shipments", delegate: prisma.shipment },
];

async function run() {
  for (const { name, delegate } of MODELS) {
    const rows = await delegate.findMany({
      where: { servicePackage: null },
      select: { id: true, referenceNo: true, services: true },
    });

    if (rows.length === 0) {
      console.log(`✓ ${name}: nothing to backfill`);
      continue;
    }

    const tally = {};
    for (const row of rows) {
      const servicePackage = inferPackageFromServices(row.services);
      const croHandledBy = resolveCroMode({ servicePackage });
      tally[servicePackage] = (tally[servicePackage] ?? 0) + 1;

      if (APPLY) {
        await delegate.update({ where: { id: row.id }, data: { servicePackage, croHandledBy } });
      }
    }

    const summary = Object.entries(tally)
      .map(([k, v]) => `${v}× ${k}`)
      .join(", ");
    console.log(`${APPLY ? "✓" : "·"} ${name}: ${rows.length} row(s) — ${summary}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these values.");
  }
}

run()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
