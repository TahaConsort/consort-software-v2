import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { scopedOutreachWhere } from "./outreach.middleware.js";

/**
 * Outreach (CRM_MASTER §5.5) — touches that already happened, on a lead OR a
 * customer. Drives lead auto-advance (WORKFLOW §2: first touch on `new` →
 * `contacted`) and the follow-ups-due dashboard. Scheduled future visits are
 * Visit Plans (ADR-043), not outreach.
 */

const DAY = 24 * 60 * 60 * 1000;

/* ─────────────────────────── hydration ─────────────────────────── */

const hydrateOutreach = async (rows) => {
  const leadIds = [...new Set(rows.map((r) => r.leadId).filter(Boolean))];
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];
  const actorIds = [...new Set(rows.map((r) => r.actorId))];

  const [leads, customers, actors] = await Promise.all([
    prisma.lead.findMany({
      where: { id: { in: leadIds } },
      select: { id: true, referenceNo: true, companyId: true, status: true },
    }),
    prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, referenceNo: true, companyId: true },
    }),
    prisma.user.findMany({
      where: { id: { in: actorIds } },
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
  const actorById = new Map(actors.map((u) => [u.id, u]));

  return rows.map((r) => {
    const lead = leadById.get(r.leadId);
    const customer = customerById.get(r.customerId);
    const actor = actorById.get(r.actorId);
    return {
      ...r,
      targetType: r.leadId ? "lead" : "customer",
      targetId: r.leadId ?? r.customerId,
      targetRef: lead?.referenceNo ?? customer?.referenceNo ?? "—",
      targetCompany: companyName.get(lead?.companyId ?? customer?.companyId) ?? "—",
      actorName: actor?.employee
        ? `${actor.employee.firstName} ${actor.employee.lastName}`
        : actor?.email ?? "—",
    };
  });
};

/* ─────────────────────────── GET /api/outreach ─────────────────────────── */
export const listOutreach = catchAsync(async (req, res) => {
  const { target } = req.query; // 'lead' | 'customer' | undefined
  const extra =
    target === "lead" ? { leadId: { not: null } } :
    target === "customer" ? { customerId: { not: null } } : {};

  const rows = await prisma.outreach.findMany({
    where: await scopedOutreachWhere(req, extra),
    orderBy: { occurredAt: "desc" },
    take: 200,
  });

  res.json({ success: true, data: await hydrateOutreach(rows) });
});

/* ─────────────────────────── POST /api/outreach ─────────────────────────── */
// One endpoint for both targets. Lead touches keep the exact semantics of the
// lead module's inline logger (same guards, same auto-advance) — customer
// touches are the retention timeline §5.3 aggregates.
export const createOutreach = catchAsync(async (req, res, next) => {
  const { leadId, customerId, type, outcome, notes, durationMin, occurredAt, followUpAt } = req.body;
  const scope = req.leadScope;

  let lead = null;
  if (leadId) {
    lead = await prisma.lead.findUnique({ where: { id: leadId } });
    // Out-of-scope reads 404, never 403 (BUSINESS_RULES §2.3).
    if (!lead || (scope && !scope.ownerIds.includes(lead.ownerId))) {
      return next(new AppError("Lead not found", 404));
    }
    if (["converted", "lost"].includes(lead.status)) {
      return next(new AppError(`Cannot log outreach on a ${lead.status} lead`, 409));
    }
  } else {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || (scope && !scope.ownerIds.includes(customer.assignedBdoId))) {
      return next(new AppError("Customer not found", 404));
    }
    if (!customer.isActive) return next(new AppError("Customer is inactive", 409));
  }

  const result = await prisma.$transaction(async (tx) => {
    const outreach = await tx.outreach.create({
      data: {
        leadId: leadId ?? null,
        customerId: customerId ?? null,
        type,
        outcome,
        notes: notes ?? null,
        durationMin: durationMin ?? null,
        occurredAt: occurredAt ?? new Date(),
        followUpAt: followUpAt ?? null,
        actorId: req.user.id,
      },
    });

    // First touch on a `new` lead advances the machine (WORKFLOW §2).
    let advanced = false;
    if (lead && lead.status === "new") {
      await tx.leadStatusHistory.create({
        data: {
          leadId: lead.id,
          fromStatus: "new",
          toStatus: "contacted",
          actorId: req.user.id,
          notes: "First outreach logged",
        },
      });
      await tx.lead.update({ where: { id: lead.id }, data: { status: "contacted" } });
      advanced = true;
    }

    return { outreach, advanced };
  });

  const [hydrated] = await hydrateOutreach([result.outreach]);
  res.status(201).json({
    success: true,
    message: result.advanced ? "Outreach logged — lead moved to contacted" : "Outreach logged",
    data: hydrated,
  });
});

/* ─────────────── GET /api/outreach/follow-ups-due ─────────────── */
// The follow-ups-due dashboard feed (§5.5): overdue, due today, and the next
// 7 days — completed visits contribute automatically because completion
// writes an outreach row with its followUpAt (RULE-VP-02).
export const followUpsDue = catchAsync(async (req, res) => {
  const now = new Date();
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const horizon = new Date(now.getTime() + 7 * DAY);

  const rows = await prisma.outreach.findMany({
    where: await scopedOutreachWhere(req, { followUpAt: { not: null, lte: horizon } }),
    orderBy: { followUpAt: "asc" },
    take: 100,
  });

  const hydrated = await hydrateOutreach(rows);
  const bucket = (r) =>
    r.followUpAt < now ? "overdue" : r.followUpAt <= endOfToday ? "today" : "upcoming";

  res.json({
    success: true,
    data: hydrated.map((r) => ({ ...r, bucket: bucket(r) })),
    counts: {
      overdue: hydrated.filter((r) => bucket(r) === "overdue").length,
      today: hydrated.filter((r) => bucket(r) === "today").length,
      upcoming: hydrated.filter((r) => bucket(r) === "upcoming").length,
    },
  });
});
