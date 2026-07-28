/**
 * One-shot backfill: give every existing shipment's steps their sub-action checklist
 * (ADR-048), composed from the shipment's FROZEN package / CRO mode / services.
 *
 * Why this is needed: `order_confirmed` moved its document pack out of the template's
 * `requiredDocTypes` and into package-gated sub-actions, so it is the sub-action rows —
 * not the template — that now carry the RULE-SH-06 gate for that step. A shipment
 * approved before this change has no rows, and would therefore confirm an order with no
 * documents at all. This closes that window.
 *
 * Already-completed steps get their manual items marked done (stamped with the step's
 * own completion), because they were done before the checklist existed and re-litigating
 * finished work would be wrong. Document items are derived, so they need no stamping.
 *
 * Idempotent: skips any (step, actionCode) pair that already exists. Safe to re-run.
 *
 *   node scripts/backfillStepActions.js            # report only
 *   node scripts/backfillStepActions.js --apply    # write
 */
import prisma from "../config/prisma.js";
import { composeStepActions } from "../utils/composition.js";
import { inferPackageFromServices, resolveCroMode } from "../utils/servicePackage.js";

const APPLY = process.argv.includes("--apply");

async function run() {
  const actionTemplates = await prisma.otdStepActionTemplate.findMany();
  if (actionTemplates.length === 0) {
    console.error("No otd_step_action_templates found — run `node prisma/seed.js --templates-only` first.");
    process.exit(1);
  }

  const shipments = await prisma.shipment.findMany({
    select: {
      id: true,
      referenceNo: true,
      services: true,
      servicePackage: true,
      croHandledBy: true,
      otdSteps: {
        select: { id: true, stepCode: true, status: true, completedAt: true, completedById: true },
      },
    },
  });

  let created = 0;
  let touched = 0;

  for (const s of shipments) {
    // A shipment approved before packages existed still has a frozen services[] —
    // infer from that rather than skip it, exactly as the approval path does.
    const servicePackage = s.servicePackage ?? inferPackageFromServices(s.services);
    const croHandledBy = resolveCroMode({ servicePackage, croHandledBy: s.croHandledBy });

    const existing = await prisma.otdStepAction.findMany({
      where: { otdStepId: { in: s.otdSteps.map((st) => st.id) } },
      select: { otdStepId: true, actionCode: true },
    });
    const have = new Set(existing.map((e) => `${e.otdStepId}:${e.actionCode}`));

    const rows = [];
    for (const step of s.otdSteps) {
      const composed = composeStepActions(actionTemplates, step.stepCode, {
        services: s.services,
        servicePackage,
        croHandledBy,
      });
      for (const a of composed) {
        if (have.has(`${step.id}:${a.actionCode}`)) continue;
        const alreadyDone = step.status === "done" && a.kind === "manual";
        rows.push({
          otdStepId: step.id,
          ...a,
          status: alreadyDone ? "done" : "pending",
          completedAt: alreadyDone ? step.completedAt : null,
          completedById: alreadyDone ? step.completedById : null,
        });
      }
    }

    if (!rows.length) continue;
    touched++;
    created += rows.length;
    if (APPLY) await prisma.otdStepAction.createMany({ data: rows });
    console.log(`${APPLY ? "✓" : "·"} ${s.referenceNo} (${servicePackage}/${croHandledBy}) — ${rows.length} sub-action(s)`);
  }

  console.log(
    `\n${APPLY ? "✓" : "·"} ${created} sub-action row(s) across ${touched} shipment(s); ${shipments.length - touched} already current.`,
  );
  if (!APPLY) console.log("Dry run. Re-run with --apply to write these rows.");
}

run()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
