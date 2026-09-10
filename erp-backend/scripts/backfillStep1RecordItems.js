/**
 * Unfreeze Step 1 on shipments composed before the `record` items were dropped.
 *
 *   node scripts/backfillStep1RecordItems.js            # report only
 *   node scripts/backfillStep1RecordItems.js --apply    # write
 *
 * Why this is needed on top of scripts/applyRoadmapWorkflow.js: that script fixes the
 * TEMPLATES, but a shipment's checklist rows are frozen copies taken at composition
 * (INV-14), so a shipment already in flight keeps whatever it was composed with. Its
 * `--recompose-untouched` pass deliberately skips any shipment with work recorded, which
 * is every shipment that has ticked even one step.
 *
 * What was frozen: Step 1 carried two `kind: "record"` items satisfied only by linking a
 * Trade Contract / Financial Instrument from the trade registers. Those registers were
 * removed, and otd.controllers refuses to tick a `record` item by hand (409, "satisfied
 * by linking the register"). So the items could never be satisfied, Step 1 could never
 * complete, and every step behind it was unreachable — the shipment was stuck forever.
 *
 * The fix mirrors the corrected template: drop the two record rows, and promote the two
 * document rows (`contract_doc`, `fi_doc`) to required, so the same evidence is still
 * demanded — as an attached scan, which is a gate a person can actually clear.
 *
 * Idempotent: a shipment already matching the template is left alone.
 */
import { pathToFileURL } from "url";
import prisma from "../config/prisma.js";

const STEP = "trade_contract_registered";
const PROMOTE = ["contract_doc", "fi_doc"];

export const run = async ({ apply = false, log = console.log } = {}) => {
  const stale = await prisma.otdStepAction.findMany({
    where: { kind: "record", otdStep: { stepCode: STEP } },
    select: { id: true, actionCode: true, otdStep: { select: { shipmentId: true } } },
  });
  const optional = await prisma.otdStepAction.findMany({
    where: { actionCode: { in: PROMOTE }, required: false, otdStep: { stepCode: STEP } },
    select: { id: true, actionCode: true, otdStep: { select: { shipmentId: true } } },
  });

  const shipmentIds = [
    ...new Set([...stale, ...optional].map((a) => a.otdStep.shipmentId)),
  ];

  if (!shipmentIds.length) {
    log("· nothing to do — every Step 1 already matches the template");
    return { shipments: 0, removed: 0, promoted: 0 };
  }

  const refs = await prisma.shipment.findMany({
    where: { id: { in: shipmentIds } },
    select: { id: true, referenceNo: true },
  });
  for (const s of refs) {
    const rm = stale.filter((a) => a.otdStep.shipmentId === s.id).length;
    const up = optional.filter((a) => a.otdStep.shipmentId === s.id).length;
    log(`  ${apply ? "✓" : "·"} ${s.referenceNo} — drop ${rm} record item(s), require ${up} document item(s)`);
  }

  if (apply) {
    await prisma.$transaction([
      prisma.otdStepAction.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } }),
      prisma.otdStepAction.updateMany({
        where: { id: { in: optional.map((a) => a.id) } },
        data: { required: true },
      }),
    ]);
  }

  log(
    `${apply ? "✓" : "·"} ${shipmentIds.length} shipment(s): ${stale.length} record item(s) removed, ${optional.length} document item(s) promoted to required`,
  );
  return { shipments: shipmentIds.length, removed: stale.length, promoted: optional.length };
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes("--apply");
  if (!apply) console.log("Dry run — nothing is written. Re-run with --apply.\n");
  run({ apply })
    .catch((err) => {
      console.error("✗ failed:", err.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
