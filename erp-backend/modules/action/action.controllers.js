import prisma from "../../config/prisma.js";
import { catchAsync } from "../../utils/catchAsync.js";

/**
 * Action Engine read surface (CRM_MASTER §5.12, RULE-AE). Domain events (never
 * statuses, ADR-020) drive templated tasks through the transactional outbox
 * (ADR-021); assignment follows the four-step chain (RULE-AE-03) and unroutable
 * actions escalate to Management (RULE-AE-05). These endpoints let Management
 * see the templates, the event flow, and anything that failed to route.
 */

/* ── GET /api/action-engine/templates ── (the task-template catalog) */
export const listTemplates = catchAsync(async (req, res) => {
  const templates = await prisma.taskTemplate.findMany({
    orderBy: [{ isActive: "desc" }, { eventCode: "asc" }],
  });
  res.json({ success: true, data: templates });
});

/* ── GET /api/action-engine/outbox?dispatched=&eventType=&take= ── (event flow) */
export const listOutbox = catchAsync(async (req, res) => {
  const where = {};
  if (req.query.dispatched === "true") where.dispatchedAt = { not: null };
  if (req.query.dispatched === "false") where.dispatchedAt = null;
  if (req.query.eventType) where.eventType = req.query.eventType;

  const events = await prisma.outboxEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Number(req.query.take) || 100,
  });

  const [pending, failed] = await Promise.all([
    prisma.outboxEvent.count({ where: { dispatchedAt: null } }),
    prisma.outboxEvent.count({ where: { dispatchedAt: null, attempts: { gt: 3 } } }),
  ]);

  res.json({ success: true, data: events, meta: { pending, stuck: failed } });
});

/* ── GET /api/action-engine/unroutable ── (dead-letter escalations, RULE-AE-05) */
export const listUnroutable = catchAsync(async (req, res) => {
  const alerts = await prisma.notification.findMany({
    where: { type: "action.unroutable" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const openCount = alerts.filter((a) => !a.readAt).length;
  res.json({ success: true, data: alerts, meta: { open: openCount } });
});
