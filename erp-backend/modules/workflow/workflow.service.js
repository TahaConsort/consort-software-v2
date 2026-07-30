import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { deriveTaskTemplateData } from "../../utils/taskTemplates.js";
import { composeOtdPath, composeStepActions } from "../../utils/composition.js";
import {
  SERVICE_PACKAGES,
  allowedCroModes,
  allowedLcModes,
  resolveServices,
} from "../../utils/servicePackage.js";
import { invalidateDocTypes } from "../document/docTypes.cache.js";

/**
 * Workflow catalog admin (ADR-051) — the write path over otd_step_templates,
 * otd_step_action_templates and document_types that used to be `prisma/seed.js` only.
 *
 * Two invariants every mutation here defends:
 *  - a composable step ALWAYS has its `otd.step` TaskTemplate (same transaction), so
 *    the Action Engine can chain its task (RULE-AE-07);
 *  - a step that any shipment ever ran is deactivated, never deleted — historical
 *    otd_steps rows resolve titles/docs/status by stepCode forever (ADR-048).
 */

const audit = (tx, actorId, action, resourceType, resourceId, diff) =>
  tx.auditLog.create({
    data: {
      actorId: actorId ?? null,
      action,
      resourceType,
      resourceId,
      diff: diff ?? undefined,
      correlationId: crypto.randomUUID(),
    },
  });

/**
 * Announce a catalog change (ADR-020/ADR-051), inside the caller's transaction.
 *
 * The step templates and the docType vocabulary feed every upload picker and every docType
 * label in the app. `invalidateDocTypes()` clears the SERVER cache; this is what tells the
 * CLIENTS. Without it an admin could rename a document type and nothing changed anywhere —
 * not even in their own session — until the tab was reloaded.
 */
const emitCatalogChanged = (tx, what, resourceId) =>
  tx.outboxEvent.create({
    data: {
      eventType: "workflow.catalog.changed",
      payload: { what, resourceId: resourceId ?? null },
      correlationId: crypto.randomUUID(),
    },
  });

/** Live references that make a step catalog row load-bearing. */
export const stepUsage = async (stepCode) => {
  const [shipmentSteps, chargeTypes] = await Promise.all([
    prisma.otdStep.count({ where: { stepCode } }),
    prisma.chargeType.count({ where: { defaultStepCode: stepCode } }),
  ]);
  return { shipmentSteps, chargeTypes };
};

/** Every docType must exist in document_types before a template may require it. */
const assertDocTypesExist = async (tx, codes) => {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return;
  const found = await tx.documentType.findMany({ where: { code: { in: unique } }, select: { code: true } });
  const missing = unique.filter((c) => !found.some((f) => f.code === c));
  if (missing.length) {
    throw new AppError(`Unknown document type(s): ${missing.join(", ")} — add them under Document Types first`, 422);
  }
};

/** Keep the step's `otd.step` TaskTemplate in lockstep (same tx as the step write). */
const syncTaskTemplate = async (tx, stepCode) => {
  const step = await tx.otdStepTemplate.findUnique({ where: { stepCode }, include: { actions: true } });
  if (!step) {
    await tx.taskTemplate.deleteMany({ where: { eventCode: "otd.step", stepCode } });
    return;
  }
  const data = { ...deriveTaskTemplateData(step, step.actions), isActive: step.active !== false };
  const existing = await tx.taskTemplate.findFirst({ where: { eventCode: "otd.step", stepCode } });
  if (existing) await tx.taskTemplate.update({ where: { id: existing.id }, data });
  else await tx.taskTemplate.create({ data });
};

export const createStep = async (body, actorId) => {
  return prisma.$transaction(async (tx) => {
    await assertDocTypesExist(tx, body.requiredDocTypes ?? []);
    const created = await tx.otdStepTemplate.create({
      data: {
        stepCode: body.stepCode,
        canonicalNo: body.canonicalNo,
        title: body.title,
        hint: body.hint ?? null,
        ownerDepartment: body.ownerDepartment,
        always: body.always ?? false,
        packages: body.packages ?? [],
        croModes: body.croModes ?? [],
        lcModes: body.lcModes ?? [],
        services: body.services ?? [],
        requiredDocTypes: body.requiredDocTypes ?? [],
        dueOffsetHours: body.dueOffsetHours ?? 48,
        derivedStatus: body.derivedStatus,
        active: body.active ?? true,
      },
    });
    await syncTaskTemplate(tx, created.stepCode);
    await audit(tx, actorId, "workflow.step.create", "otd_step_template", created.stepCode, { to: body });
    await emitCatalogChanged(tx, "step", created.stepCode);
    return created;
  });
};

export const updateStep = async (stepCode, body, actorId) => {
  return prisma.$transaction(async (tx) => {
    const before = await tx.otdStepTemplate.findUnique({ where: { stepCode } });
    if (!before) throw new AppError("Step not found", 404);
    if (body.requiredDocTypes) await assertDocTypesExist(tx, body.requiredDocTypes);
    const updated = await tx.otdStepTemplate.update({ where: { stepCode }, data: body });
    await syncTaskTemplate(tx, stepCode);
    await audit(tx, actorId, "workflow.step.update", "otd_step_template", stepCode, {
      from: Object.fromEntries(Object.keys(body).map((k) => [k, before[k]])),
      to: body,
    });
    await emitCatalogChanged(tx, "step", stepCode);
    return updated;
  });
};

export const deleteStep = async (stepCode, actorId) => {
  const usage = await stepUsage(stepCode);
  if (usage.shipmentSteps > 0 || usage.chargeTypes > 0) {
    const refs = [
      usage.shipmentSteps ? `${usage.shipmentSteps} shipment step(s)` : null,
      usage.chargeTypes ? `${usage.chargeTypes} charge type(s)` : null,
    ].filter(Boolean).join(" and ");
    throw new AppError(`This step is referenced by ${refs} — deactivate it instead of deleting`, 409);
  }
  return prisma.$transaction(async (tx) => {
    const before = await tx.otdStepTemplate.findUnique({ where: { stepCode }, include: { actions: true } });
    if (!before) throw new AppError("Step not found", 404);
    // FK cascade removes the sub-action templates with the step.
    await tx.otdStepTemplate.delete({ where: { stepCode } });
    await tx.taskTemplate.deleteMany({ where: { eventCode: "otd.step", stepCode } });
    await audit(tx, actorId, "workflow.step.delete", "otd_step_template", stepCode, { from: before });
    await emitCatalogChanged(tx, "step", stepCode);
    return { deleted: true };
  });
};

export const replaceActions = async (stepCode, actions, actorId) => {
  return prisma.$transaction(async (tx) => {
    const step = await tx.otdStepTemplate.findUnique({ where: { stepCode }, include: { actions: true } });
    if (!step) throw new AppError("Step not found", 404);
    const dup = actions.map((a) => a.actionCode).filter((c, i, arr) => arr.indexOf(c) !== i);
    if (dup.length) throw new AppError(`Duplicate action code(s): ${[...new Set(dup)].join(", ")}`, 422);
    await assertDocTypesExist(tx, actions.filter((a) => a.kind === "document").map((a) => a.docType));

    // Replace-in-whole: the checklist is small and ordered, and partial patches would
    // need their own reorder protocol for no benefit. Per-shipment otd_step_actions
    // rows are frozen copies (INV-14) and unaffected.
    await tx.otdStepActionTemplate.deleteMany({ where: { stepCode } });
    if (actions.length) {
      await tx.otdStepActionTemplate.createMany({
        data: actions.map((a) => ({
          stepCode,
          actionCode: a.actionCode,
          title: a.title,
          kind: a.kind ?? "manual",
          docType: a.kind === "document" ? a.docType : null,
          sortOrder: a.sortOrder,
          required: a.required ?? true,
          packages: a.packages ?? [],
          croModes: a.croModes ?? [],
          lcModes: a.lcModes ?? [],
          services: a.services ?? [],
        })),
      });
    }
    await syncTaskTemplate(tx, stepCode);
    await audit(tx, actorId, "workflow.step.actions.replace", "otd_step_template", stepCode, {
      from: step.actions.map((a) => a.actionCode),
      to: actions.map((a) => a.actionCode),
    });
    // A checklist change alters what a future step requires, including which document
    // types it will ask for.
    await emitCatalogChanged(tx, "checklist", stepCode);
    return tx.otdStepActionTemplate.findMany({ where: { stepCode }, orderBy: { sortOrder: "asc" } });
  });
};

/* ── Document types ── */

export const docTypeUsage = async (code) => {
  const [documents, stepTemplates, actionTemplates] = await Promise.all([
    prisma.document.count({ where: { docType: code } }),
    prisma.otdStepTemplate.count({ where: { requiredDocTypes: { has: code } } }),
    prisma.otdStepActionTemplate.count({ where: { docType: code } }),
  ]);
  return { documents, templates: stepTemplates + actionTemplates };
};

export const createDocType = async (body, actorId) => {
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.documentType.create({
      data: {
        code: body.code,
        label: body.label,
        customerUploadable: body.customerUploadable ?? false,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    await audit(tx, actorId, "workflow.doctype.create", "document_type", row.code, { to: body });
    await emitCatalogChanged(tx, "docType", row.code);
    return row;
  });
  invalidateDocTypes();
  return created;
};

export const updateDocType = async (code, body, actorId) => {
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.documentType.findUnique({ where: { code } });
    if (!before) throw new AppError("Document type not found", 404);
    const row = await tx.documentType.update({ where: { code }, data: body });
    await audit(tx, actorId, "workflow.doctype.update", "document_type", code, {
      from: Object.fromEntries(Object.keys(body).map((k) => [k, before[k]])),
      to: body,
    });
    await emitCatalogChanged(tx, "docType", code);
    return row;
  });
  invalidateDocTypes();
  return updated;
};

export const deleteDocType = async (code, actorId) => {
  const usage = await docTypeUsage(code);
  if (usage.documents > 0 || usage.templates > 0) {
    const refs = [
      usage.documents ? `${usage.documents} document(s)` : null,
      usage.templates ? `${usage.templates} template requirement(s)` : null,
    ].filter(Boolean).join(" and ");
    throw new AppError(`This document type is referenced by ${refs} — deactivate it instead of deleting`, 409);
  }
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.documentType.findUnique({ where: { code } });
    if (!before) throw new AppError("Document type not found", 404);
    await tx.documentType.delete({ where: { code } });
    await audit(tx, actorId, "workflow.doctype.delete", "document_type", code, { from: before });
    await emitCatalogChanged(tx, "docType", code);
    return { deleted: true };
  });
  invalidateDocTypes();
  return result;
};

/* ── Catalog lint (RULE-SVC-06 and friends) ── */

/**
 * Compose every package × CRO × LC combo (plus the intl destination add-on) against
 * the LIVE catalog and report what a human should look at before the next approval:
 * empty paths, paths that never reach `delivered`, dangling docTypes, steps no combo
 * composes. Warnings, not blocks — a half-built draft catalog is a valid working state.
 */
export const validateCatalog = async () => {
  const [templates, actionTemplates, docTypes] = await Promise.all([
    prisma.otdStepTemplate.findMany({ include: { actions: true } }),
    prisma.otdStepActionTemplate.findMany(),
    prisma.documentType.findMany({ select: { code: true } }),
  ]);
  const known = new Set(docTypes.map((d) => d.code));

  const combos = [];
  const composedCodes = new Set();
  for (const servicePackage of SERVICE_PACKAGES) {
    for (const croHandledBy of allowedCroModes(servicePackage)) {
      for (const lcHandledBy of allowedLcModes(servicePackage)) {
        const extraSets = servicePackage === "international" ? [[], ["destination_services"]] : [[]];
        for (const extras of extraSets) {
          const services = resolveServices({ servicePackage, services: extras, lcHandledBy });
          const path = composeOtdPath(templates, { services, servicePackage, croHandledBy, lcHandledBy });
          path.forEach((s) => composedCodes.add(s.stepCode));
          const deliveredSteps = path.filter((s) => s.derivedStatus === "delivered").length;
          const issues = [];
          if (path.length === 0) issues.push("empty path");
          if (deliveredSteps === 0) issues.push("no step derives 'delivered' — this path can never settle");
          combos.push({
            servicePackage,
            croHandledBy,
            lcHandledBy,
            withDownstream: extras.length > 0,
            stepCount: path.length,
            deliveredSteps,
            issues,
          });
        }
      }
    }
  }

  const danglingDocTypes = [];
  for (const t of templates) {
    for (const d of t.requiredDocTypes ?? []) {
      if (!known.has(d)) danglingDocTypes.push({ stepCode: t.stepCode, docType: d, source: "step" });
    }
  }
  for (const a of actionTemplates) {
    if (a.kind === "document" && a.docType && !known.has(a.docType)) {
      danglingDocTypes.push({ stepCode: a.stepCode, docType: a.docType, source: `action:${a.actionCode}` });
    }
  }

  const neverComposed = templates
    .filter((t) => t.active !== false && !composedCodes.has(t.stepCode))
    .map((t) => t.stepCode);

  return { combos, danglingDocTypes, neverComposed };
};

// Re-exported so controllers can preview a single step's composed checklist if needed.
export { composeStepActions };
