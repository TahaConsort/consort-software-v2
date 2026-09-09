/**
 * Additive rollout of the roadmap workflow (Export Shipment Workflow roadmap §2/§4/§5,
 * ADR-057) onto a LIVE database.
 *
 * Why this exists rather than just reseeding: since ADR-051 the step catalog is edited
 * live in the Workflow admin panel, and `node prisma/seed.js --templates-only
 * --factory-reset` DELETES and recreates otd_step_templates — destroying admin edits and
 * any admin-created steps. This script writes only what the roadmap needs and leaves
 * everything else alone.
 *
 * What it does, all by upsert, in order:
 *   1. the four document types the roadmap's register needs (§4);
 *   2. the eight roadmap steps applied to BOTH kinds, their checklists (with the Step 1
 *      `record` items) and their `otd.step` TaskTemplates (RULE-AE-07);
 *   3. retire the freight-forwarding path: every other step except Order Lock goes
 *      `active = false`, and its TaskTemplate `isActive = false` so the Action Engine
 *      can never raise a task for a step that no longer composes;
 *   4. re-point `charge_types.default_step_code` at roadmap steps;
 *   5. insert the roadmap §2 party directory as vendors (insert-if-absent by name);
 *   6. `--recompose-untouched` (opt-in): shipments with NO step done, no task completed
 *      and no exception get their frozen path replaced by the live catalog's, with the
 *      generated documents re-hung on the new steps. Anything with work recorded is left
 *      frozen (INV-14).
 *
 * Idempotent. Safe to re-run.
 *
 *   node scripts/applyRoadmapWorkflow.js                             # report only
 *   node scripts/applyRoadmapWorkflow.js --apply                     # write
 *   node scripts/applyRoadmapWorkflow.js --apply --recompose-untouched
 */
import crypto from "crypto";
import { pathToFileURL } from "url";
import prisma from "../config/prisma.js";
import { deriveTaskTemplateData } from "../utils/taskTemplates.js";
import { allocateRef } from "../utils/referenceNumber.js";
import { composeOtdPath, composeStepActions } from "../utils/composition.js";
import { recomputeStatus } from "../modules/shipment/shipment.service.js";
import {
  TRADE_DOCUMENT_TYPES,
  TRADE_STEP_TEMPLATES,
  TRADE_STEP_ACTION_TEMPLATES,
  TRADE_STEP_HINTS,
  CHARGE_TYPE_STEP_REMAP,
} from "../prisma/tradeWorkflow.js";
import { ROADMAP_PARTIES, normalizeVendorName } from "../prisma/roadmapParties.js";

const ROADMAP_STEP_CODES = TRADE_STEP_TEMPLATES.map((t) => t.stepCode);
/** The one kind-specific step that stays live: the customer's signed RC in front of the path. */
const ORDER_LOCK = "order_lock";

/* ── 1. Document types ─────────────────────────────────────────────────────── */
export const applyDocumentTypes = async ({ apply, log = console.log }) => {
  let added = 0;
  for (const t of TRADE_DOCUMENT_TYPES) {
    const existing = await prisma.documentType.findUnique({ where: { code: t.code } });
    if (existing) continue;
    added++;
    log(`  ${apply ? "✓" : "·"} ${t.code} — "${t.label}"`);
    if (apply) await prisma.documentType.create({ data: t });
  }
  log(`${apply ? "✓" : "·"} document types: ${added} to add, ${TRADE_DOCUMENT_TYPES.length - added} already present\n`);
  return added;
};

/* ── 2. The roadmap steps, checklists and task templates ───────────────────── */
export const applyRoadmapSteps = async ({ apply, log = console.log }) => {
  let created = 0;
  let updated = 0;
  for (const t of TRADE_STEP_TEMPLATES) {
    const data = { ...t, active: true, hint: TRADE_STEP_HINTS[t.stepCode] ?? null };
    const existing = await prisma.otdStepTemplate.findUnique({ where: { stepCode: t.stepCode } });
    if (existing) updated++;
    else created++;
    log(`  ${apply ? "✓" : "·"} ${t.stepCode} — ${existing ? "update in place" : `create (#${t.canonicalNo}, ${t.ownerDepartment})`}, applies to both kinds`);
    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      await tx.otdStepTemplate.upsert({ where: { stepCode: t.stepCode }, create: data, update: data });
      // Replace-in-whole, exactly as the admin path does: the checklist is small and
      // ordered, and per-shipment rows are frozen copies (INV-14) so nothing in flight
      // is disturbed.
      const actions = TRADE_STEP_ACTION_TEMPLATES.filter((a) => a.stepCode === t.stepCode);
      await tx.otdStepActionTemplate.deleteMany({ where: { stepCode: t.stepCode } });
      if (actions.length) await tx.otdStepActionTemplate.createMany({ data: actions });
      // RULE-AE-07: a composable step must have its `otd.step` TaskTemplate.
      const tpl = await tx.otdStepTemplate.findUnique({ where: { stepCode: t.stepCode }, include: { actions: true } });
      const taskData = { ...deriveTaskTemplateData(tpl, tpl.actions), isActive: true };
      const task = await tx.taskTemplate.findFirst({ where: { eventCode: "otd.step", stepCode: t.stepCode } });
      if (task) await tx.taskTemplate.update({ where: { id: task.id }, data: taskData });
      else await tx.taskTemplate.create({ data: taskData });
    });
  }
  log(`${apply ? "✓" : "·"} roadmap steps: ${created} created, ${updated} updated, ${TRADE_STEP_ACTION_TEMPLATES.length} checklist item(s)\n`);
  return { created, updated };
};

/* ── 3. Retire the forwarding path ─────────────────────────────────────────── */
export const retireForwardingSteps = async ({ apply, log = console.log }) => {
  const live = await prisma.otdStepTemplate.findMany({
    where: { stepCode: { notIn: [...ROADMAP_STEP_CODES, ORDER_LOCK] }, active: true },
    select: { stepCode: true, title: true },
    orderBy: { canonicalNo: "asc" },
  });
  for (const s of live) log(`  ${apply ? "✓" : "·"} ${s.stepCode} — retire (inactive; history only)`);
  if (apply) {
    if (live.length) {
      await prisma.otdStepTemplate.updateMany({
        where: { stepCode: { in: live.map((s) => s.stepCode) } },
        data: { active: false },
      });
    }
    // Every retired step's task template goes dormant, including ones retired by an
    // earlier run or by hand — the relay must never raise a task for a step that no
    // longer composes.
    const dormant = await prisma.otdStepTemplate.findMany({ where: { active: false }, select: { stepCode: true } });
    await prisma.taskTemplate.updateMany({
      where: { eventCode: "otd.step", stepCode: { in: dormant.map((s) => s.stepCode) }, isActive: true },
      data: { isActive: false },
    });
    // Order Lock stays: forwarding-only, active, in front of the roadmap steps.
    await prisma.otdStepTemplate.updateMany({
      where: { stepCode: ORDER_LOCK },
      data: { active: true, appliesToKinds: ["forwarding"] },
    });
    await prisma.taskTemplate.updateMany({ where: { eventCode: "otd.step", stepCode: ORDER_LOCK }, data: { isActive: true } });
  }
  log(`${apply ? "✓" : "·"} forwarding steps: ${live.length} to retire; ${ORDER_LOCK} stays (forwarding only)\n`);
  return live.length;
};

/* ── 4. Charge types land on roadmap steps ─────────────────────────────────── */
export const remapChargeTypes = async ({ apply, log = console.log }) => {
  let changed = 0;
  for (const [code, stepCode] of Object.entries(CHARGE_TYPE_STEP_REMAP)) {
    const row = await prisma.chargeType.findUnique({ where: { code } });
    if (!row || row.defaultStepCode === stepCode) continue;
    changed++;
    log(`  ${apply ? "✓" : "·"} ${code}: ${row.defaultStepCode ?? "—"} → ${stepCode}`);
    if (apply) await prisma.chargeType.update({ where: { code }, data: { defaultStepCode: stepCode } });
  }
  log(`${apply ? "✓" : "·"} charge types: ${changed} to re-point\n`);
  return changed;
};

/* ── 5. The party directory ────────────────────────────────────────────────── */
export const applyRoadmapParties = async ({ apply, log = console.log }) => {
  let added = 0;
  for (const p of ROADMAP_PARTIES) {
    const normalizedName = normalizeVendorName(p.name);
    const existing = await prisma.vendor.findFirst({ where: { normalizedName }, select: { id: true } });
    if (existing) continue;
    added++;
    log(`  ${apply ? "✓" : "·"} ${p.name} (${p.type})`);
    if (!apply) continue;
    // allocateRef bumps reference_sequences, so it shares the create's transaction.
    await prisma.$transaction(async (tx) => {
      const referenceNo = await allocateRef(tx, "vendor");
      await tx.vendor.create({ data: { ...p, referenceNo, normalizedName } });
    });
  }
  log(`${apply ? "✓" : "·"} parties: ${added} to add, ${ROADMAP_PARTIES.length - added} already present\n`);
  return added;
};

/* ── 6. Recompose shipments nobody has worked yet ──────────────────────────── */

/** Where a generated or uploaded document belongs on the new path, by docType. */
const stepForDocType = (path, actionsByStep, docType) => {
  if (!docType) return null;
  if (docType === "quotation") return path.find((s) => s.stepCode === "trade_contract_registered") ?? null;
  if (docType === "rate_confirmation") return path.find((s) => s.stepCode === ORDER_LOCK) ?? null;
  return (
    path.find((s) => s.requiredDocTypes.includes(docType)) ??
    path.find((s) => (actionsByStep.get(s.stepCode) ?? []).some((a) => a.docType === docType)) ??
    null
  );
};

/** True when nothing has been recorded against the shipment's current path. */
export const isUntouched = async (client, shipmentId) => {
  const [done, tasksDone, shipment] = await Promise.all([
    client.otdStep.count({ where: { shipmentId, status: "done" } }),
    client.task.count({ where: { shipmentId, status: "done" } }),
    client.shipment.findUnique({ where: { id: shipmentId }, select: { exceptionState: true, status: true } }),
  ]);
  return (
    done === 0 &&
    tasksDone === 0 &&
    shipment?.exceptionState === "none" &&
    !["settled", "closed"].includes(shipment?.status)
  );
};

/**
 * Replace one shipment's frozen path with the live catalog's. Only ever called for an
 * untouched shipment — the caller checks — so no completed step, tick, or task is lost.
 * Returns the new step codes.
 */
export const recomposeShipment = async (client, shipmentId, { actorId = null } = {}) =>
  client.$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new Error(`Shipment ${shipmentId} not found`);
    const [templates, actionTemplates] = await Promise.all([
      tx.otdStepTemplate.findMany(),
      tx.otdStepActionTemplate.findMany(),
    ]);
    const path = composeOtdPath(templates, shipment.kind);
    if (!path.length) throw new Error(`The catalog composes no ${shipment.kind} steps`);
    const actionsByStep = new Map(path.map((s) => [s.stepCode, composeStepActions(actionTemplates, s.stepCode)]));

    const oldSteps = await tx.otdStep.findMany({ where: { shipmentId }, select: { id: true } });
    await tx.otdStepAction.deleteMany({ where: { otdStepId: { in: oldSteps.map((s) => s.id) } } });
    await tx.task.deleteMany({
      where: { shipmentId, status: { in: ["queued", "open", "in_progress", "on_hold"] } },
    });
    // Documents hang off step ids that are about to go — detach first, re-hang below.
    await tx.document.updateMany({
      where: { ownerType: "shipment", ownerId: shipmentId, otdStepId: { in: oldSteps.map((s) => s.id) } },
      data: { otdStepId: null },
    });
    await tx.otdStep.deleteMany({ where: { shipmentId } });

    await tx.otdStep.createMany({
      data: path.map((s) => ({
        shipmentId,
        canonicalNo: s.canonicalNo,
        displayNo: s.displayNo,
        stepCode: s.stepCode,
        ownerDepartment: s.ownerDepartment,
      })),
    });
    const stepRows = await tx.otdStep.findMany({ where: { shipmentId }, select: { id: true, stepCode: true } });
    const idOf = new Map(stepRows.map((s) => [s.stepCode, s.id]));
    const actionData = stepRows.flatMap((row) =>
      (actionsByStep.get(row.stepCode) ?? []).map((a) => ({ otdStepId: row.id, ...a })),
    );
    if (actionData.length) await tx.otdStepAction.createMany({ data: actionData });

    const docs = await tx.document.findMany({
      where: { ownerType: "shipment", ownerId: shipmentId, deletedAt: null },
      select: { id: true, docType: true },
    });
    for (const d of docs) {
      const step = stepForDocType(path, actionsByStep, d.docType);
      if (step) await tx.document.update({ where: { id: d.id }, data: { otdStepId: idOf.get(step.stepCode) ?? null } });
    }

    await recomputeStatus(tx, shipmentId, actorId);
    await tx.shipment.update({ where: { id: shipmentId }, data: { rowVersion: { increment: 1 } } });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "shipment.recomposed",
        resourceType: "shipment",
        resourceId: shipmentId,
        diff: { steps: path.map((s) => s.stepCode) },
        correlationId: crypto.randomUUID(),
      },
    });
    // The relay re-raises the first step's task and refreshes any open detail page.
    await tx.outboxEvent.create({
      data: {
        eventType: "shipment.updated",
        payload: { shipmentId, shipmentRef: shipment.referenceNo, customerId: shipment.customerId, recomposed: true },
        correlationId: crypto.randomUUID(),
      },
    });
    return path.map((s) => s.stepCode);
  });

export const recomposeUntouched = async ({ apply, log = console.log, only = null }) => {
  const candidates = await prisma.shipment.findMany({
    where: {
      exceptionState: "none",
      status: { notIn: ["settled", "closed"] },
      ...(only ? { id: { in: only } } : {}),
    },
    select: { id: true, referenceNo: true, kind: true },
    orderBy: { createdAt: "asc" },
  });
  const liveCodes = new Set(
    (await prisma.otdStepTemplate.findMany({ where: { active: true }, select: { stepCode: true } })).map((t) => t.stepCode),
  );
  let done = 0;
  let skipped = 0;
  for (const s of candidates) {
    const steps = await prisma.otdStep.findMany({ where: { shipmentId: s.id }, select: { stepCode: true }, orderBy: { canonicalNo: "asc" } });
    const onRetiredPath = steps.some((x) => !liveCodes.has(x.stepCode));
    if (!onRetiredPath) continue; // already on the live catalog
    if (!(await isUntouched(prisma, s.id))) {
      skipped++;
      log(`  · ${s.referenceNo} — work recorded on its ${steps.length}-step path; left frozen (INV-14)`);
      continue;
    }
    done++;
    log(`  ${apply ? "✓" : "·"} ${s.referenceNo} (${s.kind}) — ${steps.length} retired step(s) → recompose`);
    if (apply) {
      const codes = await recomposeShipment(prisma, s.id);
      log(`      now: ${codes.join(" → ")}`);
    }
  }
  log(`${apply ? "✓" : "·"} recompose: ${done} shipment(s), ${skipped} left frozen\n`);
  return { done, skipped };
};

/* ── Report the resulting paths ────────────────────────────────────────────── */
export const reportPaths = async (log = console.log) => {
  const all = await prisma.otdStepTemplate.findMany({ where: { active: true }, orderBy: { canonicalNo: "asc" } });
  for (const kind of ["forwarding", "trade"]) {
    const path = composeOtdPath(all, kind);
    const settles = path.some((t) => t.derivedStatus === "delivered");
    log(`✓ ${kind}: ${path.map((s) => s.stepCode).join(" → ")}${settles ? "" : "  ⚠ no step derives 'delivered' — this path can never settle"}`);
  }
};

const runCli = async () => {
  const apply = process.argv.includes("--apply");
  const recompose = process.argv.includes("--recompose-untouched");
  console.log(apply ? "Applying the roadmap workflow…\n" : "Dry run — nothing is written.\n");
  await applyDocumentTypes({ apply });
  await applyRoadmapSteps({ apply });
  await retireForwardingSteps({ apply });
  await remapChargeTypes({ apply });
  await applyRoadmapParties({ apply });
  if (recompose) await recomposeUntouched({ apply });
  else console.log("· recompose: skipped (pass --recompose-untouched to migrate shipments nobody has worked yet)\n");
  if (apply) await reportPaths();
  else console.log("Re-run with --apply to write these rows.");
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
    .catch((e) => {
      console.error("Apply failed:", e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
