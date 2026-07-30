import prisma from "../../config/prisma.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { isManagement, hasRole } from "../auth/auth.middleware.js";
import { teamUserIds } from "../lead/lead.middleware.js";
import { getUserDepartmentId } from "../chat/chat.service.js";
import { getUserDeptCode } from "../shipment/shipment.middleware.js";

/**
 * Role-aware dashboard (CRM_MASTER §5.17). One endpoint, a defined payload per
 * role group — the role determines the view. Changing an employee's role changes
 * what this returns, because the branch is chosen from the live role.
 */

const countByStatus = (rows) =>
  rows.reduce((acc, r) => ({ ...acc, [r.status]: r._count._all }), {});

const DAY = 24 * 60 * 60 * 1000;

/* ── Management / HR — cross-cutting KPIs (§5.17) ── */
const managementDashboard = async () => {
  const [
    employees, customers, leadsByStatus, openQueries, shipmentsByStatus,
    liveQuotations, openTasks, unroutable, payments, issuedInvoices,
  ] = await Promise.all([
    prisma.employee.count({ where: { isActive: true } }),
    prisma.customer.count({ where: { isActive: true } }),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.query.count({ where: { status: "open" } }),
    prisma.shipment.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.quotation.count({ where: { status: { in: ["draft", "sent"] } } }),
    prisma.task.count({ where: { status: { in: ["queued", "open", "in_progress"] } } }),
    prisma.notification.count({ where: { type: "action.unroutable", readAt: null } }),
    prisma.payment.aggregate({ _sum: { amount: true } }),
    prisma.invoice.aggregate({ where: { status: { in: ["issued", "part_paid", "paid"] } }, _sum: { totalAmount: true } }),
  ]);

  return {
    kind: "management",
    kpis: {
      employees,
      customers,
      leads: countByStatus(leadsByStatus),
      openQueries,
      liveQuotations,
      shipments: countByStatus(shipmentsByStatus),
      openTasks,
      unroutableAlerts: unroutable,
      revenue: {
        invoiced: Number(issuedInvoices._sum.totalAmount ?? 0),
        collected: Number(payments._sum.amount ?? 0),
      },
    },
  };
};

/* ── Sales (bdo / asm) — my leads, queries, visits, shipments (§5.17) ── */
const salesDashboard = async (user) => {
  const owners = hasRole(user, "asm") ? await teamUserIds(user) : [user.id];
  const customers = await prisma.customer.findMany({
    where: { assignedBdoId: { in: owners } },
    select: { id: true },
  });
  const customerIds = customers.map((c) => c.id);

  const [leadsByStatus, openQueries, upcomingVisits, followUpsDue, shipmentsByStatus] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where: { ownerId: { in: owners } }, _count: { _all: true } }),
    prisma.query.count({ where: { status: "open", customerId: { in: customerIds } } }),
    prisma.visitPlan.count({ where: { assignedToId: { in: owners }, status: "planned", plannedAt: { gte: new Date() } } }),
    prisma.outreach.count({ where: { actorId: { in: owners }, followUpAt: { not: null, lte: new Date(Date.now() + 7 * DAY) } } }),
    prisma.shipment.groupBy({ by: ["status"], where: { customerId: { in: customerIds } }, _count: { _all: true } }),
  ]);

  const recentShipments = await prisma.shipment.findMany({
    where: { customerId: { in: customerIds } },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { id: true, referenceNo: true, status: true, exceptionState: true, services: true },
  });

  return {
    kind: "sales",
    kpis: {
      leads: countByStatus(leadsByStatus),
      openQueries,
      upcomingVisits,
      followUpsDue,
      shipments: countByStatus(shipmentsByStatus),
    },
    recentShipments,
  };
};

/* ── Ops / Compliance / Transport / Finance — dept shipments + task queue (§5.17) ── */
const departmentDashboard = async (user) => {
  const deptId = await getUserDepartmentId(user.id);
  const deptCode = await getUserDeptCode(user.id);

  const [activeShipments, queued, myTasks, overdue, recentTasks] = await Promise.all([
    prisma.shipment.count({
      where: {
        exceptionState: { not: "cancelled" },
        status: { notIn: ["closed"] },
        otdSteps: { some: { ownerDepartment: deptCode } },
      },
    }),
    prisma.task.count({ where: { departmentId: deptId, status: "queued" } }),
    prisma.task.count({ where: { assigneeId: user.id, status: { in: ["open", "in_progress"] } } }),
    prisma.task.count({ where: { departmentId: deptId, status: { in: ["open", "in_progress"] }, dueDate: { lt: new Date() } } }),
    prisma.task.findMany({
      where: { departmentId: deptId, status: { in: ["queued", "open", "in_progress"] } },
      orderBy: [{ dueDate: "asc" }],
      take: 8,
    }),
  ]);

  return {
    kind: "department",
    department: deptCode,
    kpis: { activeShipments, queuedTasks: queued, myTasks, overdueTasks: overdue },
    recentTasks,
  };
};

/* ── Customer portal — own shipments, queries, invoices (§5.16/5.17) ── */
const customerDashboard = async (user) => {
  const [shipments, queriesByStatus, invoices, templates] = await Promise.all([
    prisma.shipment.findMany({
      where: { customerId: user.customerId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, referenceNo: true, status: true, exceptionState: true, services: true,
        // The package is what the customer actually bought — the portal shows that
        // rather than the internal service codes. croHandledBy/lcHandledBy drive the
        // "we're waiting on your CRO/LC" prompts (ADR-050).
        servicePackage: true, croHandledBy: true, lcHandledBy: true,
        originPort: true, destinationPort: true, pickupAddress: true, deliveryAddress: true, eta: true,
        // §5.16 — the customer tracks the stages their order ACTUALLY has, so
        // ship the composed path (titles come from the templates below).
        otdSteps: {
          orderBy: { displayNo: "asc" },
          select: { displayNo: true, stepCode: true, status: true, completedAt: true },
        },
      },
    }),
    prisma.query.groupBy({ by: ["status"], where: { customerId: user.customerId }, _count: { _all: true } }),
    prisma.invoice.count({ where: { shipment: { customerId: user.customerId }, status: { in: ["issued", "part_paid"] } } }),
    prisma.otdStepTemplate.findMany({ select: { stepCode: true, title: true } }),
  ]);

  const titleByCode = Object.fromEntries(templates.map((t) => [t.stepCode, t.title]));
  const withProgress = shipments.map((s) => {
    const doneCount = s.otdSteps.filter((st) => st.status === "done").length;
    return {
      ...s,
      otdSteps: s.otdSteps.map((st) => ({ ...st, title: titleByCode[st.stepCode] ?? st.stepCode })),
      progress: { done: doneCount, total: s.otdSteps.length },
    };
  });

  return {
    kind: "customer",
    kpis: { activeShipments: shipments.length, queries: countByStatus(queriesByStatus), openInvoices: invoices },
    shipments: withProgress,
  };
};

/* ── GET /api/dashboard ── */
export const getDashboard = catchAsync(async (req, res) => {
  let payload;

  // Priority for a multi-role user: Management/HR → Sales → Customer → Department.
  if (isManagement(req.user) || hasRole(req.user, "hr")) {
    payload = await managementDashboard();
  } else if (hasRole(req.user, "asm", "bdo")) {
    payload = await salesDashboard(req.user);
  } else if (req.user.role === "customer") {
    payload = await customerDashboard(req.user);
  } else {
    payload = await departmentDashboard(req.user); // ops/compliance/transport/finance
  }

  res.json({ success: true, data: { role: req.user.role, roles: req.user.roles, ...payload } });
});
