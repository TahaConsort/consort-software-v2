import crypto from "crypto";
import prisma from "../config/prisma.js";
import { emitToUser, emitToRooms } from "../realtime/io.js";
import { isPermittedOutOfOrder } from "../utils/composition.js";
import { fanOutFor } from "../utils/eventTopics.js";

/**
 * Outbox relay + Action Engine (ADR-020/021, WORKFLOW §6/§9/§10, RULE-AE).
 *
 * Polls undispatched `outbox_events` and fans them out to consumers:
 *   · in-app notifications (+ delivery rows, RULE-NT-03) and socket hints,
 *   · the Action Engine — domain events (never statuses) instantiate the next
 *     OTD step's task and route it down the deterministic assignment chain
 *     (RULE-AE-02/03), idempotently (RULE-AE-04).
 *
 * Consumers are idempotent: tasks upsert on idempotency_key, so a replay is a
 * no-op. A failed row is retried with an attempt counter and never blocks the
 * queue. Real-time emits are safe no-ops until the socket gateway is up
 * (ADR-007 — REST is complete without sockets).
 */

const POLL_MS = 3000;
const BATCH = 20;
const MAX_ATTEMPTS = 5;

/* ─────────────────────── notification helpers ─────────────────────── */

// Emit a domain event from within relay processing (ADR-020 — the catalog is
// closed and every member flows through the outbox; picked up on the next poll).
const emitOutbox = (eventType, payload) =>
  prisma.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

const notifyUsers = async (userIds, { type, title, body, actionUrl, priority }) => {
  const unique = [...new Set(userIds)].filter(Boolean);
  for (const userId of unique) {
    const n = await prisma.notification.create({
      data: { userId, type, title, body: body ?? null, actionUrl: actionUrl ?? null, priority: priority ?? 0 },
    });
    await prisma.notificationDelivery.create({
      data: { notificationId: n.id, channel: "in_app", status: "sent", sentAt: new Date() },
    });
    emitToUser(userId, "notification:new", n); // live push (EDGE-T-05 invalidation hint)
  }
};

const usersWithRole = async (...roles) => {
  const users = await prisma.user.findMany({
    where: { role: { in: roles }, isActive: true },
    select: { id: true },
  });
  return users.map((u) => u.id);
};

const customerPortalUsers = async (customerId) => {
  const users = await prisma.user.findMany({
    where: { customerId, role: "customer", isActive: true },
    select: { id: true },
  });
  return users.map((u) => u.id);
};

/* ─────────────────────── Action Engine (RULE-AE) ─────────────────────── */

// RULE-AE-03 assignment chain, adjusted per CRM_MASTER §5.12 / WORKFLOW §10:
// the task must land on the FIELD EMPLOYEE who owns the step — so the
// least-loaded active department member is tried first, the department head is
// the fallback (only when the department has no members — e.g. Finance headed
// by the CFO, who sits in Management and cannot execute), then the queue.
const resolveAssignee = async (departmentId, dept) => {
  const members = await prisma.user.findMany({
    where: { isActive: true, employee: { departmentId, isActive: true } },
    select: { id: true },
  });

  if (members.length) {
    const memberIds = members.map((m) => m.id);
    const load = await prisma.task.groupBy({
      by: ["assigneeId"],
      where: { assigneeId: { in: memberIds }, status: { in: ["open", "in_progress"] } },
      _count: { _all: true },
    });
    const loadById = new Map(load.map((l) => [l.assigneeId, l._count._all]));
    return memberIds.sort((a, b) => (loadById.get(a) ?? 0) - (loadById.get(b) ?? 0))[0];
  }

  if (dept?.headUserId) {
    const head = await prisma.user.findFirst({ where: { id: dept.headUserId, isActive: true }, select: { id: true } });
    if (head) return head.id;
  }

  return null; // department queue (RULE-AE-03 tail)
};

// The step at the front of the line: first pending step whose predecessors are all
// done (a permitted pair may be out of order — RULE-SH-03, see OUT_OF_ORDER_PAIRS).
const nextActionableStep = (steps) => {
  for (const step of steps) {
    if (step.status !== "pending") continue;
    const priorPending = steps.filter((s) => s.canonicalNo < step.canonicalNo && s.status !== "done");
    if (priorPending.length === 0) return step;
    if (priorPending.length === 1 && isPermittedOutOfOrder(priorPending[0].stepCode, step.stepCode)) {
      return step;
    }
    return null; // blocked — nothing further is actionable yet
  }
  return null;
};

// Create the next OTD step's task and route it (RULE-AE-02/03/07). No-op for
// held/cancelled/closed shipments (RULE-AE-06).
const createNextStepTask = async (shipmentId) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) return;
  if (shipment.exceptionState !== "none" || ["settled", "closed"].includes(shipment.status)) return;

  const steps = await prisma.otdStep.findMany({ where: { shipmentId }, orderBy: { canonicalNo: "asc" } });
  const step = nextActionableStep(steps);
  if (!step) return; // path complete or blocked — nothing to create

  const dept = await prisma.department.findUnique({ where: { code: step.ownerDepartment } });
  const template = await prisma.taskTemplate.findFirst({
    where: { eventCode: "otd.step", stepCode: step.stepCode, isActive: true },
  });

  if (!dept) {
    // No department to own the work → escalate as a domain event (RULE-AE-05, §6).
    await emitOutbox("action.unroutable", {
      shipmentId,
      referenceNo: shipment.referenceNo,
      stepCode: step.stepCode,
      reason: "no_department",
    });
    return;
  }

  if (!template) {
    // RULE-AE-05 — no matching template must NEVER be silent. Alert Management,
    // then still create a sensible fallback task so the work isn't dropped.
    await emitOutbox("action.unroutable", {
      shipmentId,
      referenceNo: shipment.referenceNo,
      stepCode: step.stepCode,
      reason: "no_template",
    });
  }

  const assigneeId = await resolveAssignee(dept.id, dept);
  const dueDate = new Date(Date.now() + (template?.dueOffsetHours ?? 48) * 60 * 60 * 1000);
  const prettyStep = step.stepCode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  try {
    const task = await prisma.task.create({
      data: {
        // Replay-safe (RULE-AE-04); reopen-aware so a reopened step gets a FRESH
        // task instead of colliding with its old done/cancelled one (RULE-SH-05).
        idempotencyKey: step.reopenCount > 0 ? `step:${step.id}:r${step.reopenCount}` : `step:${step.id}`,
        origin: "otd_step",
        templateId: template?.id ?? null,
        shipmentId,
        otdStepId: step.id,
        title: template?.title ?? `Complete: ${prettyStep}`,
        description: template?.description ?? null,
        departmentId: dept.id,
        assigneeId,
        status: assigneeId ? "open" : "queued",
        dueDate,
      },
    });

    if (assigneeId) {
      emitToUser(assigneeId, "task:assigned", task);
      await notifyUsers([assigneeId], {
        type: "task.assigned",
        title: `New task — ${task.title}`,
        body: `Shipment ${shipment.referenceNo}`,
        actionUrl: "/admin/tasks",
        priority: 1,
      });
    } else {
      // No eligible assignee → queued; announce as a domain event (§6).
      await emitOutbox("task.unassigned", {
        taskId: task.id,
        title: task.title,
        departmentId: dept.id,
        departmentName: dept.name,
        departmentHeadUserId: dept.headUserId ?? null,
        shipmentRef: shipment.referenceNo,
      });
    }
  } catch (err) {
    if (err?.code !== "P2002") throw err; // already created for this step → no-op
  }
};

/* ─────────────────────── event consumers (WORKFLOW §6) ─────────────────────── */

const HANDLERS = {
  "lead.created": async () => {},

  // ── Intake channels (CRM_MASTER §5.20/§5.21, WORKFLOW §2b/§2c) ──

  // Self-service signup on the storefront (§5.16/§5.20) — Sales must pick it up
  // and assign a BDO; a name clash is flagged for a deliberate human merge.
  "customer.registered": async (payload) => {
    const dupe = payload.possibleDuplicate?.length
      ? ` ⚠ A company named "${payload.possibleDuplicate[0]}" already exists — verify before merging.`
      : "";
    await notifyUsers(await usersWithRole("asm", "bdo"), {
      type: "customer.registered",
      title: `New customer signed up — ${payload.companyName}`,
      body: `${payload.contactName} (${payload.email}${payload.phone ? `, ${payload.phone}` : ""}) registered as ${payload.customerRef}. Assign a BDO.${dupe}`,
      actionUrl: "/admin/customers",
      priority: payload.possibleDuplicate?.length ? 2 : 1,
    });
  },

  "inquiry.received": async (payload) => {
    await notifyUsers(await usersWithRole("asm", "bdo"), {
      type: "inquiry.received",
      title: `New storefront inquiry ${payload.referenceNo}`,
      body: `${payload.companyName ?? "A visitor"} requested a quote. Triage in the inbox.`,
      actionUrl: "/admin/inquiries",
      priority: 1,
    });
  },

  "inquiry.converted": async () => {},

  // A converted customer was given a portal login + activation invite (§5.16).
  // The Notifications module (email) would deliver the activation link; until
  // then, tell the owner an invite is pending so they can pass it on. The raw
  // token is never in this payload — it's kept out of the DB (like RULE-EMP-01).
  "customer.invited": async (payload) => {
    await notifyUsers([payload.ownerId], {
      type: "customer.invited",
      title: `Portal invite ready — ${payload.customerRef}`,
      body: `An activation link was created for ${payload.email}. Once activated they can approve or reject their own quotes.`,
      actionUrl: "/admin/customers",
    });
  },

  "lc.received": async (payload) => {
    await notifyUsers(await usersWithRole("ops_exec", "ops_manager"), {
      type: "lc.received",
      title: `New bank LC ${payload.referenceNo}`,
      body: `LC ${payload.lcNumber}${payload.applicantName ? ` — ${payload.applicantName}` : ""} is in the inbox.`,
      actionUrl: "/admin/lc-inbox",
      priority: 1,
    });
  },

  "lc.converted": async (payload) => {
    await notifyUsers(await usersWithRole("asm", "ops_manager"), {
      type: "lc.converted",
      title: `LC ${payload.referenceNo} converted`,
      body: `Customer ${payload.customerRef}, query ${payload.queryRef} created.`,
      actionUrl: "/admin/queries",
    });
  },

  "lead.converted": async (payload) => {
    await notifyUsers(await usersWithRole("asm"), {
      type: "lead.converted",
      title: `Lead ${payload.leadRef} converted`,
      body: `Customer ${payload.customerRef} created.`,
      actionUrl: "/admin/customers",
    });
  },

  "lead.stale": async (payload) => {
    const targets = [payload.ownerId];
    if (payload.escalate) targets.push(...(await usersWithRole("asm")));
    await notifyUsers(targets, {
      type: "lead.stale",
      title: `Lead ${payload.referenceNo} is going stale`,
      body: `${payload.days} days without outreach.`,
      actionUrl: `/admin/leads/${payload.leadId}`,
    });
  },

  "visit.scheduled": async (payload) => {
    await notifyUsers([payload.assignedToId], {
      type: "visit.scheduled",
      title: "Visit planned",
      body: `${payload.purpose} — ${new Date(payload.plannedAt).toLocaleString()}`,
      actionUrl: "/admin/visits",
    });
  },

  "visit.completed": async () => {},

  "visit.no_show": async (payload) => {
    const targets = [payload.assignedToId, ...(await usersWithRole("asm"))];
    await notifyUsers(targets, {
      type: "visit.no_show",
      title: "Visit no-show",
      body: `${payload.purpose} — client did not attend. Reschedule?`,
      actionUrl: "/admin/visits",
    });
  },

  "query.created": async (payload) => {
    await notifyUsers(await usersWithRole("ops_manager", "ops_exec"), {
      type: "query.created",
      title: `New query ${payload.referenceNo}`,
      body: `Services: ${(payload.services ?? []).join(", ")}`,
      actionUrl: "/admin/queries",
    });
  },

  "query.hazardous": async (payload) => {
    const dept = await prisma.department.findUnique({ where: { code: "compliance" } });
    if (dept) {
      try {
        await prisma.task.create({
          data: {
            idempotencyKey: `precheck:${payload.queryId}`,
            origin: "query_precheck",
            queryId: payload.queryId,
            title: `Compliance pre-check — ${payload.referenceNo}`,
            description: "Hazardous/reefer cargo flagged on this query. Review before pricing.",
            departmentId: dept.id,
            status: "queued",
            dueDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
          },
        });
      } catch (err) {
        if (err?.code !== "P2002") throw err;
      }
    }
    await notifyUsers(await usersWithRole("compliance_manager", "compliance_exec"), {
      type: "query.hazardous",
      title: `Pre-check needed — ${payload.referenceNo}`,
      body: "Hazardous or reefer cargo requires a compliance pre-check.",
      actionUrl: "/admin/queries",
    });
  },

  "query.stale": async (payload) => {
    const targets = [payload.raisedById, ...(await usersWithRole("asm"))];
    await notifyUsers(targets, {
      type: "query.stale",
      title: `Query ${payload.referenceNo} is going stale`,
      body: `${payload.days} days without a quotation.`,
      actionUrl: "/admin/queries",
    });
  },

  "query.expired": async (payload) => {
    await notifyUsers([payload.raisedById], {
      type: "query.expired",
      title: `Query ${payload.referenceNo} expired`,
      body: "90 days passed without a quotation.",
      actionUrl: "/admin/queries",
    });
  },

  // ── Quotation ──
  "quotation.sent": async (payload) => {
    const query = await prisma.query.findUnique({ where: { id: payload.queryId } });
    if (!query) return;
    const customer = await prisma.customer.findUnique({ where: { id: query.customerId } });
    const targets = [
      ...(await customerPortalUsers(query.customerId)),
      customer?.assignedBdoId,
    ];
    await notifyUsers(targets, {
      type: "quotation.sent",
      title: `Quotation ${payload.referenceNo} sent`,
      body: "A quotation is ready for a decision.",
      actionUrl: "/admin/quotations",
      priority: 1,
    });
  },

  "quotation.rejected": async (payload) => {
    await notifyUsers(await usersWithRole("ops_manager", "ops_exec"), {
      type: "quotation.rejected",
      title: `Quotation ${payload.referenceNo} rejected`,
      body: "The customer requested a revision.",
      actionUrl: "/admin/quotations",
    });
  },

  // ── Quote approval — THE PIVOT. Fire the Action Engine (RULE-QT-07/RULE-AE). ──
  "quotation.approved": async (payload) => {
    await createNextStepTask(payload.shipmentId); // first composed step's task
    emitToRooms([`shipment:${payload.shipmentId}`, `customer:${payload.customerId}`], "shipment:updated", {
      shipmentId: payload.shipmentId,
    });
    const ops = await usersWithRole("ops_manager", "ops_exec");
    await notifyUsers(ops, {
      type: "shipment.created",
      title: `Shipment ${payload.shipmentRef} created`,
      body: `Services: ${(payload.services ?? []).join(", ")}`,
      actionUrl: "/admin/shipments",
      priority: 1,
    });
  },

  // ── Vendor RFQs (buy side) ──
  // Creation and edits ride the topic fan-out alone: the ops person who sent the
  // request is the one watching the board, and notifying them of their own click
  // is noise. Only an actual vendor reply and an award are worth a nudge.
  "rfq.created": async () => {},
  "rfq.updated": async () => {},

  "rfq.quote_received": async (payload) => {
    await notifyUsers(await usersWithRole("ops_manager", "ops_exec"), {
      type: "rfq.quote_received",
      title: `Vendor rate in — ${payload.referenceNo}`,
      body: `${payload.vendorName} quoted ${payload.currency} ${payload.totalAmount} for ${payload.service}.`,
      actionUrl: "/admin/rfqs",
    });
  },

  "rfq.awarded": async (payload) => {
    await notifyUsers(await usersWithRole("ops_manager", "ops_exec"), {
      type: "rfq.awarded",
      title: `${payload.referenceNo} awarded to ${payload.vendorName}`,
      body: "The cost is locked in — build the customer quote.",
      actionUrl: "/admin/rfqs",
      priority: 1,
    });
  },

  "shipment.created": async (payload) => {
    emitToRooms([`shipment:${payload.shipmentId}`, `customer:${payload.customerId}`], "shipment:updated", {
      shipmentId: payload.shipmentId,
    });
  },

  "shipment.held": async (payload) => {
    emitToRooms([`shipment:${payload.shipmentId}`], "shipment:updated", { shipmentId: payload.shipmentId });
  },

  "shipment.resumed": async (payload) => {
    // RULE-AE-06 — a resume thaws what the hold froze, INCLUDING generation: a
    // hold that landed before the first task was created must not lose it forever.
    await createNextStepTask(payload.shipmentId);
    emitToRooms([`shipment:${payload.shipmentId}`], "shipment:updated", { shipmentId: payload.shipmentId });
  },

  "shipment.cancelled": async (payload) => {
    emitToRooms([`shipment:${payload.shipmentId}`], "shipment:updated", { shipmentId: payload.shipmentId });
  },

  "shipment.closed": async () => {},

  // ── Finance ──
  "invoice.issued": async (payload) => {
    const shipment = await prisma.shipment.findUnique({ where: { id: payload.shipmentId } });
    if (shipment) {
      await notifyUsers(await customerPortalUsers(shipment.customerId), {
        type: "invoice.issued",
        title: `Invoice ${payload.referenceNo} issued`,
        actionUrl: "/dashboard",
      });
    }
  },

  "payment.received": async () => {},

  // ── Scheduler-emitted events (WORKFLOW §14) ──
  "quotation.expiring": async (payload) => {
    await notifyUsers([payload.createdById, ...(await usersWithRole("ops_manager"))], {
      type: "quotation.expiring",
      title: `Quotation ${payload.referenceNo} expires soon`,
      body: "Validity ends within 48 hours.",
      actionUrl: "/admin/quotations",
      priority: 1,
    });
  },

  "quotation.expired": async (payload) => {
    await notifyUsers([payload.createdById, ...(await usersWithRole("ops_manager"))], {
      type: "quotation.expired",
      title: `Quotation ${payload.referenceNo} expired`,
      body: "The query has returned to revision-requested.",
      actionUrl: "/admin/quotations",
    });
  },

  "invoice.overdue": async (payload) => {
    const targets = await usersWithRole("accounts");
    if (payload.escalate) targets.push(...(await usersWithRole("ceo", "project_director", "director", "cfo", "gm")));
    await notifyUsers(targets, {
      type: "invoice.overdue",
      title: `Invoice ${payload.referenceNo} overdue ${payload.days}d`,
      body: payload.escalate ? "Escalated to Management (30d+)." : "Chase payment.",
      actionUrl: "/admin/finance",
      priority: payload.escalate ? 2 : 1,
    });
  },

  "task.overdue": async (payload) => {
    const targets = [payload.assigneeId].filter(Boolean);
    const dept = await prisma.department.findUnique({ where: { id: payload.departmentId }, select: { headUserId: true } });
    if (dept?.headUserId) targets.push(dept.headUserId);
    if (payload.escalate) targets.push(...(await usersWithRole("ceo", "project_director", "director", "cfo", "gm")));
    await notifyUsers(targets, {
      type: "task.overdue",
      title: `Overdue task — ${payload.title}`,
      body: `${payload.hours}h past due${payload.escalate ? " · escalated (48h+)" : ""}.`,
      actionUrl: "/admin/tasks",
      priority: payload.escalate ? 2 : 1,
    });
  },

  "task.unassigned": async (payload) => {
    // RULE-AE-05 — a queued task must never be silent: tell the department head,
    // or Management when the department has no head/members (EDGE-SH-02).
    const targets = payload.departmentHeadUserId
      ? [payload.departmentHeadUserId]
      : await usersWithRole("ceo", "project_director", "director", "cfo", "gm");
    await notifyUsers(targets, {
      type: "task.unassigned",
      title: `Task waiting in the ${payload.departmentName} queue`,
      body: `"${payload.title}" (shipment ${payload.shipmentRef}) has no assignee — someone needs to claim it.`,
      actionUrl: "/admin/tasks",
      priority: 1,
    });
  },

  "shipment.eta_breached": async (payload) => {
    // Auto-raise an ETA exception + notify Ops (idempotent per shipment).
    const existing = await prisma.shipmentException.findFirst({
      where: { shipmentId: payload.shipmentId, type: "other", resolvedAt: null, reason: { startsWith: "ETA breached" } },
    });
    if (!existing) {
      // ShipmentException.raisedById is non-null → use a Management user as the system actor.
      const [sys] = await usersWithRole("ceo", "project_director", "director", "cfo", "gm");
      if (sys) {
        await prisma.shipmentException.create({
          data: { shipmentId: payload.shipmentId, type: "other", reason: `ETA breached (${new Date(payload.eta).toISOString().slice(0, 10)})`, raisedById: sys },
        }).catch(() => {});
      }
    }
    await notifyUsers(await usersWithRole("ops_manager", "ops_exec"), {
      type: "shipment.eta_breached",
      title: `ETA breached — ${payload.referenceNo}`,
      body: `Still ${payload.status} past ETA.`,
      actionUrl: `/admin/shipments/${payload.shipmentId}`,
      priority: 2,
    });
  },

  "action.unroutable": async (payload) => {
    const prettyStep = (payload.stepCode ?? "").replace(/_/g, " ");
    const body =
      payload.reason === "no_department"
        ? `No department is set up to own the "${prettyStep}" step — the shipment cannot move until this is fixed.`
        : payload.reason === "no_template"
          ? `No task template exists for the "${prettyStep}" step — a fallback task was created, but the template should be seeded.`
          : "Work on this shipment could not be routed to anyone.";
    await notifyUsers(await usersWithRole("ceo", "project_director", "director", "cfo", "gm"), {
      type: "action.unroutable",
      title: `Attention needed — ${payload.referenceNo ?? "a shipment"} has unroutable work`,
      body,
      actionUrl: "/admin/action-engine",
      priority: 2,
    });
  },

  "user.deactivated": async () => {
    // Sockets are force-disconnected inline at deactivation (EDGE-A-04); nothing
    // further to fan out. Handler exists so the event is not "unhandled".
  },

  // task.assigned via claim/reassign (the Action-Engine-created tasks notify inline).
  "task.assigned": async (payload) => {
    if (!payload.reassigned && !payload.assigneeId) return;
    const task = await prisma.task.findUnique({ where: { id: payload.taskId } });
    if (!task?.assigneeId) return;
    emitToUser(task.assigneeId, "task:assigned", task);
    await notifyUsers([task.assigneeId], {
      type: "task.assigned",
      title: `Task assigned to you — ${task.title}`,
      actionUrl: "/admin/tasks",
      priority: 1,
    });
    // RULE-TK-04 — a reassignment notifies BOTH parties.
    if (payload.reassigned && payload.previousAssigneeId) {
      await notifyUsers([payload.previousAssigneeId], {
        type: "task.assigned",
        title: `Task moved off your queue — ${task.title}`,
        body: "A manager reassigned this task to someone else.",
        actionUrl: "/admin/tasks",
      });
    }
  },
};

// Prefix handlers for the per-step event families (shipment.step.completed:<code>).
const PREFIX_HANDLERS = {
  "shipment.step.completed:": async (payload) => {
    await createNextStepTask(payload.shipmentId); // chain the next task (RULE-TK-02)
    const rooms = [`shipment:${payload.shipmentId}`];
    if (payload.customerId) rooms.push(`customer:${payload.customerId}`); // live portal tracking (§5.16)
    emitToRooms(rooms, "shipment:stepCompleted", {
      shipmentId: payload.shipmentId,
      stepCode: payload.stepCode,
      displayNo: payload.displayNo,
      newStatus: payload.newStatus,
    });
    emitToRooms(rooms, "shipment:updated", { shipmentId: payload.shipmentId });
  },
  "shipment.step.reopened:": async (payload) => {
    // RULE-SH-05 — re-queue the (now different) front-of-line step's task; the
    // reopen-aware idempotency key makes this a fresh row, not a swallowed P2002.
    await createNextStepTask(payload.shipmentId);
    const rooms = [`shipment:${payload.shipmentId}`];
    if (payload.customerId) rooms.push(`customer:${payload.customerId}`);
    emitToRooms(rooms, "shipment:updated", { shipmentId: payload.shipmentId });
  },
};

const resolveHandler = (eventType) => {
  if (HANDLERS[eventType]) return HANDLERS[eventType];
  for (const [prefix, fn] of Object.entries(PREFIX_HANDLERS)) {
    if (eventType.startsWith(prefix)) return fn;
  }
  return null;
};

/* ─────────────────────── the relay loop ─────────────────────── */

export const drainOutboxOnce = async () => {
  const events = await prisma.outboxEvent.findMany({
    where: { dispatchedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });

  for (const event of events) {
    try {
      const handler = resolveHandler(event.eventType);
      if (handler) await handler(event.payload, event);
      else {
        // Previously silent: an event with no handler was marked dispatched and vanished
        // without a trace, so a new eventType could look wired up while doing nothing.
        console.warn(`Outbox: no handler for "${event.eventType}" (event ${event.id})`);
      }

      // The generic invalidation fan-out (ADR-007). One place, table-driven: the handlers
      // above do notifications and Action-Engine work, and 29 of 37 pushed nothing to any
      // room — which is why every list screen in the app needed a manual reload to see
      // another user's changes. `data:changed` carries topic names only, never entity data.
      const fan = fanOutFor(event.eventType, event.payload ?? {});
      if (fan) emitToRooms(fan.rooms, "data:changed", { topics: fan.topics, event: event.eventType });
      else if (handler) {
        console.warn(`Outbox: "${event.eventType}" has no invalidation row (utils/eventTopics.js) — no client will re-read`);
      }

      await prisma.outboxEvent.update({ where: { id: event.id }, data: { dispatchedAt: new Date() } });
    } catch (err) {
      const attempts = event.attempts + 1;
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { attempts: { increment: 1 }, lastError: String(err?.message ?? err).slice(0, 500) },
      });
      // At MAX_ATTEMPTS the row drops out of the query above forever, and reapOutbox only
      // deletes DISPATCHED rows — so it sits in the table permanently. Say so once, loudly,
      // instead of leaving it to be discovered as a "stuck" counter on the admin console.
      if (attempts >= MAX_ATTEMPTS) {
        console.error(
          `Outbox: "${event.eventType}" (event ${event.id}) exhausted ${MAX_ATTEMPTS} attempts and will NOT be retried: ${String(err?.message ?? err).slice(0, 200)}`,
        );
      }
    }
  }

  return events.length;
};

let timer = null;

export const startOutboxRelay = () => {
  if (timer) return;
  timer = setInterval(() => {
    drainOutboxOnce().catch((err) => console.error("Outbox relay error:", err.message));
  }, POLL_MS);
  timer.unref?.();
  console.log(`Outbox relay started (every ${POLL_MS / 1000}s)`);
};
