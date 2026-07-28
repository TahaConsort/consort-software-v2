import prisma from "../../config/prisma.js";
import { catchAsync } from "../../utils/catchAsync.js";

/**
 * Audit (CRM_MASTER §5.19, INV-15). Every mutation is written once by the
 * modules' audit calls with actor, field-level diff and correlation id. This is
 * the Management-only, filterable read surface + per-resource history.
 */

// Hydrate actor identities in one round-trip.
const hydrate = async (logs) => {
  const actorIds = [...new Set(logs.map((l) => l.actorId).filter(Boolean))];
  const users = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, email: true, role: true, employee: { select: { firstName: true, lastName: true } } },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return logs.map((l) => {
    const u = byId.get(l.actorId);
    return {
      ...l,
      actor: u ? { email: u.email, role: u.role, name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : null } : null,
    };
  });
};

/* ── GET /api/audit ── filterable, paginated */
export const listAudit = catchAsync(async (req, res) => {
  const { actorId, resourceType, resourceId, action } = req.query;
  const page = Number(req.query.page) || 1;
  const take = Number(req.query.take) || 50;

  const where = {};
  if (actorId) where.actorId = actorId;
  if (resourceType) where.resourceType = resourceType;
  if (resourceId) where.resourceId = resourceId;
  if (action) where.action = { contains: action, mode: "insensitive" };
  if (req.query.from || req.query.to) {
    where.createdAt = {};
    if (req.query.from) where.createdAt.gte = new Date(req.query.from);
    if (req.query.to) where.createdAt.lte = new Date(req.query.to);
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take }),
  ]);

  res.json({
    success: true,
    data: await hydrate(logs),
    meta: { page, take, total, pages: Math.ceil(total / take) },
  });
});

/* ── GET /api/audit/resource/:resourceType/:resourceId ── per-resource history */
export const resourceHistory = catchAsync(async (req, res) => {
  const { resourceType, resourceId } = req.params;
  const logs = await prisma.auditLog.findMany({
    where: { resourceType, resourceId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ success: true, data: await hydrate(logs) });
});

/* ── GET /api/audit/facets ── distinct resource types & actions for filter UI */
export const auditFacets = catchAsync(async (req, res) => {
  const [types, actions] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ["resourceType"], select: { resourceType: true }, take: 100 }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, take: 200 }),
  ]);
  res.json({
    success: true,
    data: {
      resourceTypes: types.map((t) => t.resourceType).sort(),
      actions: actions.map((a) => a.action).sort(),
    },
  });
});
