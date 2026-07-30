import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { shipmentInScope, getUserDeptCode } from "./otd.middleware.js";
import {
  completeStepTx,
  recomputeStatus,
  isHeld,
  emitShipmentEvent,
  auditShipment,
  withStepActions,
} from "../shipment/shipment.service.js";

/**
 * OTD — Order to Delivery (CRM_MASTER §5.9, WORKFLOW §5.1/§10, RULE-SH).
 *
 * The service-driven step engine. A shipment runs only the SUBSET of the 14
 * canonical steps its selected services compose (ADR-040); rows exist only for
 * that subset (INV-04). Progress is written ONLY through step completion, and
 * `shipments.status` is DERIVED from the highest completed step (ADR-014, INV-02)
 * — this module never writes status directly. All transactional work is shared
 * with the task module via `shipment.service.js` (ADR-001), so completing a step
 * here and completing its task (RULE-TK-02) can never diverge.
 */

/** Load a shipment and enforce row-level scope, or 404 (BUSINESS_RULES §2.3). */
const loadShipmentInScope = async (req, next) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.shipmentId } });
  if (!shipment || !(await shipmentInScope(req, shipment))) {
    next(new AppError("Shipment not found", 404));
    return null;
  }
  return shipment;
};

/* ── GET /api/otd/:shipmentId/steps ── (the composed path, display-ordered) */
export const listSteps = catchAsync(async (req, res, next) => {
  const shipment = await loadShipmentInScope(req, next);
  if (!shipment) return;
  const rows = await prisma.otdStep.findMany({
    where: { shipmentId: shipment.id },
    orderBy: { displayNo: "asc" },
  });
  const steps = await withStepActions(prisma, shipment.id, rows);
  res.json({
    success: true,
    data: {
      shipmentId: shipment.id,
      referenceNo: shipment.referenceNo,
      status: shipment.status,
      exceptionState: shipment.exceptionState,
      stepCount: steps.length,
      steps,
    },
  });
});

/* ── PATCH /api/otd/:shipmentId/steps/:displayNo/actions/:actionCode ── (RULE-SH-13) */
// Tick or untick one MANUAL sub-action of a step (ADR-048). Document sub-actions are
// derived from the shipment's files and are deliberately not writable here — ticking one
// by hand would let a step claim a document it does not have.
export const setStepAction = catchAsync(async (req, res, next) => {
  const shipment = await loadShipmentInScope(req, next);
  if (!shipment) return;
  if (["settled", "closed"].includes(shipment.status) || shipment.exceptionState === "cancelled") {
    return next(new AppError("A finished or cancelled shipment's steps can't be edited", 409));
  }
  if (isHeld(shipment)) {
    return next(new AppError("This shipment is on hold — resume it before recording progress", 409));
  }

  const step = await prisma.otdStep.findFirst({
    where: { shipmentId: shipment.id, displayNo: Number(req.params.displayNo) },
  });
  if (!step) return next(new AppError("Step not found on this shipment's path", 404));
  if (step.status === "done") {
    return next(new AppError("This step is already complete — reopen it to change its checklist", 409));
  }

  // RULE-SH-04 — the checklist belongs to whoever owns the step.
  const actorDeptCode = await getUserDeptCode(req.user.id);
  if (actorDeptCode !== step.ownerDepartment) {
    return next(new AppError("Only the step's owning department can update this checklist", 403));
  }

  const action = await prisma.otdStepAction.findFirst({
    where: { otdStepId: step.id, actionCode: req.params.actionCode },
  });
  if (!action) return next(new AppError("Checklist item not found on this step", 404));
  if (action.kind !== "manual") {
    return next(new AppError("This item is satisfied by attaching its document, not by ticking it", 409));
  }

  const done = req.body.done !== false; // default to ticking
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.otdStepAction.update({
      where: { id: action.id },
      data: {
        status: done ? "done" : "pending",
        completedById: done ? req.user.id : null,
        completedAt: done ? new Date() : null,
        ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
      },
    });
    await auditShipment(tx, {
      actorId: req.user.id,
      action: done ? "shipment.step.action.complete" : "shipment.step.action.reopen",
      resourceType: "shipment",
      resourceId: shipment.id,
      diff: { stepCode: step.stepCode, actionCode: row.actionCode, title: row.title },
    });
    // The tick changes the step's blocking count, which is exactly what the Complete
    // button reads — so anyone else with this shipment open needs to see it.
    await emitShipmentEvent(tx, "shipment.step.updated", {
      shipmentId: shipment.id, stepCode: step.stepCode, actionCode: row.actionCode,
    });
    return row;
  });

  res.json({
    success: true,
    message: done ? `"${updated.title}" marked done` : `"${updated.title}" reopened`,
    data: updated,
  });
});

/* ── PATCH /api/otd/:shipmentId/steps/:displayNo/details ── (per-step notes/form capture) */
export const updateStepDetails = catchAsync(async (req, res, next) => {
  const shipment = await loadShipmentInScope(req, next);
  if (!shipment) return;
  if (["settled", "closed"].includes(shipment.status) || shipment.exceptionState === "cancelled") {
    return next(new AppError("A finished or cancelled shipment's steps can't be edited", 409));
  }
  const step = await prisma.otdStep.findFirst({
    where: { shipmentId: shipment.id, displayNo: Number(req.params.displayNo) },
  });
  if (!step) return next(new AppError("Step not found on this shipment's path", 404));

  const data = {};
  if (req.body.notes !== undefined) data.notes = req.body.notes;
  if (req.body.formData !== undefined) data.formData = req.body.formData;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.otdStep.update({ where: { id: step.id }, data });
    // Handover notes are written for whoever picks the step up next, so their screen has
    // to show them without being reloaded.
    await emitShipmentEvent(tx, "shipment.step.updated", {
      shipmentId: shipment.id, stepCode: step.stepCode,
    });
    return row;
  });
  res.json({ success: true, message: "Step details saved", data: updated });
});

/* ── PATCH /api/otd/:shipmentId/steps/:displayNo/complete ── (RULE-SH-03/04/06/07) */
// All business guards (hold, closed, ownership, sequence, force, docs) live in
// completeStepTx under the advisory lock (ADR-001); this endpoint only handles
// scope, lookup and the optimistic-concurrency handshake.
export const completeStep = catchAsync(async (req, res, next) => {
  const shipment = await loadShipmentInScope(req, next);
  if (!shipment) return;

  // RULE-SH-07 — optimistic concurrency is MANDATORY on direct step completion.
  //
  // Both refusals now carry the CURRENT rowVersion. Without it the client had no way to
  // recover except asking the user to reload, which is the behaviour being removed: the
  // task-completion path bumps this same rowVersion with no If-Match of its own
  // (task.controllers.js), so a colleague finishing a task could hand an innocent user a
  // 412 on their very first click.
  const ifMatch = req.body.rowVersion ?? req.headers["if-match"];
  if (ifMatch === undefined) {
    return next(new AppError(
      "Your page needs a refresh before completing this step — reload and try again",
      428,
      { rowVersion: shipment.rowVersion },
    ));
  }
  if (Number(ifMatch) !== shipment.rowVersion) {
    return next(new AppError(
      "Someone else updated this shipment while you had it open — refresh and try again",
      412,
      { rowVersion: shipment.rowVersion },
    ));
  }

  const step = await prisma.otdStep.findFirst({
    where: { shipmentId: shipment.id, displayNo: Number(req.params.displayNo) },
  });
  if (!step) return next(new AppError("Step not found on this shipment's path", 404));

  const actorDeptCode = await getUserDeptCode(req.user.id);
  const newStatus = await prisma.$transaction((tx) =>
    completeStepTx(tx, {
      shipment,
      step,
      actorId: req.user.id,
      actorDeptCode,
      canForce: req.user.permissions.includes("shipment.force_override"),
      forceReason: req.body.forceReason,
    }),
  );

  const [tpl, fresh] = await Promise.all([
    prisma.otdStepTemplate.findUnique({ where: { stepCode: step.stepCode } }),
    // completeStepTx bumped rowVersion; hand it back so a second completion on the same
    // page does not have to wait for a refetch to avoid a 412.
    prisma.shipment.findUnique({ where: { id: shipment.id }, select: { rowVersion: true } }),
  ]);
  res.json({
    success: true,
    message: `"${tpl?.title ?? step.stepCode}" completed`,
    data: { status: newStatus, rowVersion: fresh?.rowVersion ?? null },
  });
});

/* ── PATCH /api/otd/:shipmentId/steps/:displayNo/reopen ── (RULE-SH-05) */
export const reopenStep = catchAsync(async (req, res, next) => {
  const shipment = await loadShipmentInScope(req, next);
  if (!shipment) return;
  if (["settled", "closed"].includes(shipment.status)) {
    return next(new AppError(`A ${shipment.status} shipment cannot be reopened`, 409));
  }
  if (shipment.exceptionState === "cancelled") {
    return next(new AppError("This shipment is cancelled — its steps cannot be reopened", 409));
  }
  if (isHeld(shipment)) {
    // RULE-SH-09 — OTD writes (reopen included) are blocked while held.
    return next(new AppError("This shipment is on hold — resume it before reopening steps", 409));
  }

  const steps = await prisma.otdStep.findMany({ where: { shipmentId: shipment.id }, orderBy: { canonicalNo: "asc" } });
  const step = steps.find((s) => s.displayNo === Number(req.params.displayNo));
  if (!step) return next(new AppError("Step not found on this shipment's path", 404));

  // RULE-SH-05 — reopening needs manager authority IN THE OWNING DEPARTMENT
  // (Management passes everything, ADR-044).
  const deptCode = await getUserDeptCode(req.user.id);
  if (deptCode !== "management" && deptCode !== step.ownerDepartment) {
    return next(new AppError("Only a manager in the step's owning department can reopen it", 403));
  }

  const newStatus = await prisma.$transaction(async (tx) => {
    // Reopen step n and every step after it (RULE-SH-05). Every affected step —
    // including still-pending ones whose task we cancel below — gets its
    // reopenCount bumped so the relay's reopen-aware idempotency key mints a
    // FRESH task instead of colliding with the old row (RULE-AE-04).
    const affected = steps.filter((s) => s.canonicalNo >= step.canonicalNo);
    const toReopen = affected.filter((s) => s.status === "done");
    for (const s of toReopen) {
      await tx.otdStep.update({
        where: { id: s.id },
        data: { status: "pending", completedById: null, completedAt: null },
      });
    }
    await tx.otdStep.updateMany({
      where: { id: { in: affected.map((s) => s.id) } },
      data: { reopenCount: { increment: 1 } },
    });

    // The checklist is part of the step's work, so reopening the step reopens it too
    // (ADR-048) — otherwise a redone step would inherit ticks nobody re-verified.
    await tx.otdStepAction.updateMany({
      where: { otdStepId: { in: affected.map((s) => s.id) }, kind: "manual" },
      data: { status: "pending", completedById: null, completedAt: null },
    });

    // Cancel now-stale open tasks from this step onward — the front of the line
    // has moved back, so their sequence position is no longer valid. The relay
    // re-creates the correct front task (reopen-aware idempotency key).
    await tx.task.updateMany({
      where: { otdStepId: { in: affected.map((s) => s.id) }, status: { in: ["queued", "open", "in_progress", "on_hold"] } },
      data: { status: "cancelled", cancelReason: `Step reopened: ${req.body.reason}` },
    });

    const status = await recomputeStatus(tx, shipment.id, req.user.id);
    await auditShipment(tx, {
      actorId: req.user.id,
      action: "shipment.step.reopen",
      resourceType: "shipment",
      resourceId: shipment.id,
      diff: { fromStep: step.stepCode, reason: req.body.reason, reopened: toReopen.length },
    });
    await emitShipmentEvent(tx, `shipment.step.reopened:${step.stepCode}`, {
      shipmentId: shipment.id,
      customerId: shipment.customerId,
      stepCode: step.stepCode,
      reopened: toReopen.length,
      reason: req.body.reason,
    });
    return status;
  });

  res.json({ success: true, message: "Step reopened — later steps were reset and work was re-queued", data: { status: newStatus } });
});
