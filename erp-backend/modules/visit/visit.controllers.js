import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { hasRole } from "../auth/auth.middleware.js";
import { visitInScope } from "./visit.middleware.js";

/**
 * Visit Plans (ADR-043, WORKFLOW §2a):
 *   planned → completed | cancelled | no_show ;  no_show/planned → planned (reschedule)
 * Completing a visit writes an Outreach touch (RULE-VP-02), which can advance
 * the lead machine exactly like a logged meeting — including new → contacted.
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

const hydrateVisits = async (visits) => {
  const leadIds = [...new Set(visits.map((v) => v.leadId).filter(Boolean))];
  const customerIds = [...new Set(visits.map((v) => v.customerId).filter(Boolean))];
  const userIds = [...new Set(visits.map((v) => v.assignedToId))];

  const [leads, customers, users] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, referenceNo: true, companyId: true } }),
    prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, referenceNo: true, companyId: true } }),
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  const companies = await prisma.company.findMany({
    where: { id: { in: [...leads.map((l) => l.companyId), ...customers.map((c) => c.companyId)] } },
    select: { id: true, name: true },
  });

  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const userById = new Map(users.map((u) => [u.id, u]));

  return visits.map((v) => {
    const lead = leadById.get(v.leadId);
    const customer = customerById.get(v.customerId);
    const user = userById.get(v.assignedToId);
    return {
      ...v,
      targetType: v.leadId ? "lead" : "customer",
      targetRef: lead?.referenceNo ?? customer?.referenceNo ?? "—",
      targetCompany: companyName.get(lead?.companyId ?? customer?.companyId) ?? "—",
      assignedToName: user?.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user?.email ?? "—",
    };
  });
};

const scopedWhere = (req, extra = {}) =>
  req.leadScope ? { ...extra, assignedToId: { in: req.leadScope.ownerIds } } : extra;

/* ── GET /api/visits ── */
export const listVisits = catchAsync(async (req, res) => {
  const { status } = req.query;
  const visits = await prisma.visitPlan.findMany({
    where: scopedWhere(req, status ? { status } : {}),
    orderBy: [{ status: "asc" }, { plannedAt: "asc" }],
  });
  res.json({ success: true, data: await hydrateVisits(visits) });
});

/* ── POST /api/visits ── */
export const createVisit = catchAsync(async (req, res, next) => {
  const { leadId, customerId, purpose, plannedAt, location, assignedToId } = req.body;

  // Validate target exists and is in scope (a BDO can't plan against another's lead).
  if (leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || (req.leadScope && !req.leadScope.ownerIds.includes(lead.ownerId))) {
      return next(new AppError("Lead not found", 404));
    }
  } else {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return next(new AppError("Customer not found", 404));
  }

  const assigningOther = assignedToId && assignedToId !== req.user.id;
  const mayAssign = req.leadScope === null || hasRole(req.user, "asm");
  if (assigningOther && !mayAssign) {
    return next(new AppError("You cannot assign visits to another user", 403));
  }

  const visit = await prisma.$transaction(async (tx) => {
    const created = await tx.visitPlan.create({
      data: {
        leadId: leadId ?? null,
        customerId: customerId ?? null,
        purpose,
        plannedAt,
        location,
        assignedToId: assignedToId || req.user.id,
        createdById: req.user.id,
      },
    });
    await emitEvent(tx, "visit.scheduled", {
      visitId: created.id,
      assignedToId: created.assignedToId,
      purpose,
      plannedAt,
    });
    return created;
  });

  const [hydrated] = await hydrateVisits([visit]);
  res.status(201).json({ success: true, message: "Visit planned", data: hydrated });
});

/* ── POST /api/visits/:id/complete ── */
// Outcome + notes; writes the outreach touch in the SAME transaction
// (RULE-VP-02) and auto-advances a `new` lead to `contacted` (WORKFLOW §2).
export const completeVisit = catchAsync(async (req, res, next) => {
  const visit = await prisma.visitPlan.findUnique({ where: { id: req.params.id } });
  if (!visit || !visitInScope(req, visit)) return next(new AppError("Visit not found", 404));
  if (visit.status !== "planned") {
    return next(new AppError(`Only a planned visit can be completed (this one is ${visit.status})`, 409));
  }

  const { outcome, notes, followUpAt } = req.body;

  const updated = await prisma.$transaction(async (tx) => {
    const done = await tx.visitPlan.update({
      where: { id: visit.id },
      data: { status: "completed", outcome, outcomeNotes: notes ?? null },
    });

    // The completed visit IS an outreach touch (site_visit) on the target.
    await tx.outreach.create({
      data: {
        leadId: visit.leadId,
        customerId: visit.customerId,
        type: "site_visit",
        outcome,
        notes: notes ? `Visit: ${notes}` : `Visit completed — ${visit.purpose}`,
        occurredAt: new Date(),
        followUpAt: followUpAt ?? null,
        visitPlanId: visit.id,
        actorId: req.user.id,
      },
    });

    // Auto-advance the lead machine, exactly as a logged meeting would.
    if (visit.leadId) {
      const lead = await tx.lead.findUnique({ where: { id: visit.leadId } });
      if (lead?.status === "new") {
        await tx.leadStatusHistory.create({
          data: {
            leadId: lead.id,
            fromStatus: "new",
            toStatus: "contacted",
            actorId: req.user.id,
            notes: "First outreach logged (completed visit)",
          },
        });
        await tx.lead.update({ where: { id: lead.id }, data: { status: "contacted" } });
      }
    }

    await emitEvent(tx, "visit.completed", { visitId: visit.id, leadId: visit.leadId, outcome });
    return done;
  });

  const [hydrated] = await hydrateVisits([updated]);
  res.json({ success: true, message: "Visit completed — outreach touch recorded", data: hydrated });
});

/* ── POST /api/visits/:id/no-show ── */
export const noShowVisit = catchAsync(async (req, res, next) => {
  const visit = await prisma.visitPlan.findUnique({ where: { id: req.params.id } });
  if (!visit || !visitInScope(req, visit)) return next(new AppError("Visit not found", 404));
  if (visit.status !== "planned") return next(new AppError("Only a planned visit can be a no-show", 409));

  const updated = await prisma.$transaction(async (tx) => {
    const done = await tx.visitPlan.update({ where: { id: visit.id }, data: { status: "no_show" } });
    // BDO notified, ASM escalated (RULE-VP-04) — via relay.
    await emitEvent(tx, "visit.no_show", {
      visitId: visit.id,
      assignedToId: visit.assignedToId,
      purpose: visit.purpose,
    });
    return done;
  });

  const [hydrated] = await hydrateVisits([updated]);
  res.json({ success: true, message: "Marked no-show", data: hydrated });
});

/* ── POST /api/visits/:id/cancel ── */
export const cancelVisit = catchAsync(async (req, res, next) => {
  const visit = await prisma.visitPlan.findUnique({ where: { id: req.params.id } });
  if (!visit || !visitInScope(req, visit)) return next(new AppError("Visit not found", 404));
  if (visit.status !== "planned") return next(new AppError("Only a planned visit can be cancelled", 409));

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.visitPlan.update({
      where: { id: visit.id },
      data: { status: "cancelled", cancelReason: req.body.reason },
    });
    await emitEvent(tx, "visit.cancelled", { visitId: u.id, assignedToId: u.assignedToId });
    return u;
  });

  const [hydrated] = await hydrateVisits([updated]);
  res.json({ success: true, message: "Visit cancelled", data: hydrated });
});

/* ── POST /api/visits/:id/reschedule ── */
// planned → planned (new date/time) and no_show → planned (WORKFLOW §2a).
export const rescheduleVisit = catchAsync(async (req, res, next) => {
  const visit = await prisma.visitPlan.findUnique({ where: { id: req.params.id } });
  if (!visit || !visitInScope(req, visit)) return next(new AppError("Visit not found", 404));
  if (!["planned", "no_show"].includes(visit.status)) {
    return next(new AppError(`A ${visit.status} visit cannot be rescheduled`, 409));
  }

  const updated = await prisma.$transaction(async (tx) => {
    const done = await tx.visitPlan.update({
      where: { id: visit.id },
      data: { status: "planned", plannedAt: req.body.plannedAt },
    });
    await emitEvent(tx, "visit.scheduled", {
      visitId: visit.id,
      assignedToId: visit.assignedToId,
      purpose: visit.purpose,
      plannedAt: req.body.plannedAt,
    });
    return done;
  });

  const [hydrated] = await hydrateVisits([updated]);
  res.json({ success: true, message: "Visit rescheduled", data: hydrated });
});
