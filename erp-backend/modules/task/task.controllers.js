import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { scopedTaskWhere, taskInScope } from "./task.middleware.js";
import { getUserDeptCode } from "../shipment/shipment.middleware.js";
import { completeStepTx } from "../shipment/shipment.service.js";

/**
 * Tasks (CRM_MASTER §5.12, RULE-TK). The department work queue. Completing a
 * task that belongs to an OTD step COMPLETES that step and advances the shipment
 * (RULE-TK-02) — the field employee's explicit act.
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

// RULE-TK-04 — claim/reassign are audited.
const auditTask = (tx, actorId, action, taskId, diff) =>
  tx.auditLog.create({
    data: { actorId, action, resourceType: "task", resourceId: taskId, diff, correlationId: crypto.randomUUID() },
  });

const hydrate = async (tasks) => {
  const deptIds = [...new Set(tasks.map((t) => t.departmentId))];
  const assigneeIds = [...new Set(tasks.map((t) => t.assigneeId).filter(Boolean))];
  const shipmentIds = [...new Set(tasks.map((t) => t.shipmentId).filter(Boolean))];
  const stepIds = [...new Set(tasks.map((t) => t.otdStepId).filter(Boolean))];

  const [departments, assignees, shipments, chargeGroups] = await Promise.all([
    prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true, code: true } }),
    prisma.user.findMany({
      where: { id: { in: assigneeIds } },
      select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
    }),
    prisma.shipment.findMany({ where: { id: { in: shipmentIds } }, select: { id: true, referenceNo: true } }),
    // Batch the per-step money for all step-linked tasks on this page.
    stepIds.length
      ? prisma.shipmentCharge.groupBy({
          by: ["otdStepId", "direction"],
          where: { otdStepId: { in: stepIds }, status: { not: "cancelled" } },
          _count: true,
          _sum: { estimatedAmount: true },
        })
      : Promise.resolve([]),
  ]);
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const userById = new Map(assignees.map((u) => [u.id, u]));
  const shipById = new Map(shipments.map((s) => [s.id, s]));

  // Fold the grouped charge sums into { stepId: { receivable, payable } }.
  const moneyByStep = new Map();
  for (const g of chargeGroups) {
    const entry = moneyByStep.get(g.otdStepId) ?? { receivable: { count: 0, total: 0 }, payable: { count: 0, total: 0 } };
    entry[g.direction] = { count: g._count, total: Number(g._sum.estimatedAmount ?? 0) };
    moneyByStep.set(g.otdStepId, entry);
  }

  return tasks.map((t) => {
    const a = userById.get(t.assigneeId);
    return {
      ...t,
      departmentName: deptById.get(t.departmentId)?.name ?? "—",
      assigneeName: a?.employee ? `${a.employee.firstName} ${a.employee.lastName}` : a?.email ?? null,
      shipmentRef: t.shipmentId ? shipById.get(t.shipmentId)?.referenceNo ?? null : null,
      stepMoney: t.otdStepId ? moneyByStep.get(t.otdStepId) ?? null : null,
    };
  });
};

/* ── GET /api/tasks?status= ── */
export const listTasks = catchAsync(async (req, res) => {
  const extra = {};
  if (req.query.status) extra.status = req.query.status;
  const where = scopedTaskWhere(req, extra);
  const tasks = await prisma.task.findMany({ where, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }] });
  res.json({ success: true, data: await hydrate(tasks) });
});

/* ── GET /api/tasks/:id ── */
export const getTask = catchAsync(async (req, res, next) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task || !taskInScope(req, task)) return next(new AppError("Task not found", 404));
  const [hydrated] = await hydrate([task]);
  res.json({ success: true, data: hydrated });
});

/* ── POST /api/tasks/:id/claim ── (pick up a queued task, RULE-AE-03 tail) */
export const claimTask = catchAsync(async (req, res, next) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task || !taskInScope(req, task)) return next(new AppError("Task not found", 404));
  if (task.assigneeId) return next(new AppError("Task is already assigned", 409));

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.task.update({
      where: { id: task.id },
      data: { assigneeId: req.user.id, status: task.status === "queued" ? "open" : task.status, rowVersion: { increment: 1 } },
    });
    await emitEvent(tx, "task.assigned", { taskId: u.id, assigneeId: req.user.id });
    await auditTask(tx, req.user.id, "task.claim", u.id, { title: u.title });
    return u;
  });
  const [hydrated] = await hydrate([updated]);
  res.json({ success: true, message: "Task claimed", data: hydrated });
});

/* ── POST /api/tasks/:id/reassign ── (manager, RULE-TK-04) */
export const reassignTask = catchAsync(async (req, res, next) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task || !taskInScope(req, task)) return next(new AppError("Task not found", 404));

  const target = await prisma.user.findUnique({
    where: { id: req.body.assigneeId },
    select: { id: true, isActive: true, employee: { select: { departmentId: true } } },
  });
  if (!target || !target.isActive) return next(new AppError("Assignee not found", 404));

  // RULE-TK-04 — the new assignee must belong to the task's owning department,
  // otherwise the task becomes permanently unexecutable (RULE-SH-04 would 403).
  if (target.employee?.departmentId !== task.departmentId) {
    return next(new AppError("The new assignee must belong to the task's department", 422));
  }

  const previousAssigneeId = task.assigneeId;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.task.update({
      where: { id: task.id },
      data: { assigneeId: target.id, status: task.status === "queued" ? "open" : task.status, rowVersion: { increment: 1 } },
    });
    await emitEvent(tx, "task.assigned", { taskId: u.id, assigneeId: target.id, previousAssigneeId, reassigned: true });
    await auditTask(tx, req.user.id, "task.reassign", u.id, { from: previousAssigneeId, to: target.id });
    return u;
  });
  const [hydrated] = await hydrate([updated]);
  res.json({ success: true, message: "Task reassigned", data: hydrated });
});

/* ── POST /api/tasks/:id/complete ── (RULE-TK-02) */
export const completeTask = catchAsync(async (req, res, next) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task || !taskInScope(req, task)) return next(new AppError("Task not found", 404));
  if (["done", "cancelled"].includes(task.status)) return next(new AppError(`Task is already ${task.status}`, 409));
  if (task.slaPausedAt) return next(new AppError("Task is frozen — its shipment is on hold", 409));

  // OTD-step task → completing it completes the step and advances the shipment.
  // ALL step guards (hold, closed, ownership, sequence, force, docs) live in
  // completeStepTx (ADR-001) — this path can no longer bypass any of them.
  if (task.otdStepId && task.shipmentId) {
    const shipment = await prisma.shipment.findUnique({ where: { id: task.shipmentId } });
    if (!shipment) return next(new AppError("Shipment not found", 404));

    const step = await prisma.otdStep.findUnique({ where: { id: task.otdStepId } });
    if (!step) return next(new AppError("Step not found", 404));
    if (step.status === "done") {
      // Step already advanced elsewhere — just close the task.
      await prisma.task.update({ where: { id: task.id }, data: { status: "done", completedById: req.user.id, completedAt: new Date() } });
      return res.json({ success: true, message: "Task completed" });
    }

    const actorDeptCode = await getUserDeptCode(req.user.id);
    const newStatus = await prisma.$transaction(async (tx) => {
      // completeStepTx also closes this task (RULE-TK-02 both directions).
      const status = await completeStepTx(tx, {
        shipment,
        step,
        actorId: req.user.id,
        actorDeptCode,
        canForce: req.user.permissions.includes("shipment.force_override"),
        forceReason: req.body?.forceReason,
      });
      return status;
    });
    return res.json({ success: true, message: `Task completed — shipment advanced to ${newStatus}`, data: { status: newStatus } });
  }

  // Ad-hoc / pre-check task → simply complete it.
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "done", completedById: req.user.id, completedAt: new Date(), rowVersion: { increment: 1 } },
  });
  res.json({ success: true, message: "Task completed" });
});
