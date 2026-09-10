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

// Matches on the PRIMARY role or any secondary one in `roles[]` — the same test as
// hasRole() in auth.middleware. Filtering `role` alone silently skipped a multi-role
// user whose second hat (say web_manager) was the one that mattered.
const usersWithRole = async (...roles) => {
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ role: { in: roles } }, { roles: { hasSome: roles } }] },
    select: { id: true },
  });
  return users.map((u) => u.id);
};

// Document types are admin-managed data, so a notification says "Rate Confirmation
// (RC)", not "rate_confirmation".
const docTypeLabelFor = async (code) => {
  if (!code) return "document";
  const row = await prisma.documentType.findUnique({ where: { code }, select: { label: true } });
  return row?.label ?? code;
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

  // Ops ownership (2026-09-08): an operations step belongs to whoever CLAIMED the
  // shipment, not to whichever ops desk is least busy. Unclaimed leaves the task in
  // the department queue, which is the signal for someone to pick the job up.
  const assigneeId =
    step.ownerDepartment === "operations"
      ? shipment.opsOwnerId ?? null
      : await resolveAssignee(dept.id, dept);
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
    // Conversion by ops leaves the customer in the claim pool — put it in front of
    // the whole Sales floor so a BDO picks it up before the quote lands.
    if (payload.unclaimed) {
      await notifyUsers(await usersWithRole("bdo"), {
        type: "lc.converted",
        title: `Unclaimed bank-LC query ${payload.queryRef}`,
        body: `Customer ${payload.customerRef} has no BDO yet — claim it in Queries › Bank LC to own the quote decision.`,
        actionUrl: "/admin/queries",
        priority: 1,
      });
    }
  },

  // A shipment now has an owner: hand them every operations task that was sitting
  // in the queue waiting for exactly this.
  "shipment.claimed": async (payload) => {
    if (!payload.ownerId) return;
    const steps = await prisma.otdStep.findMany({
      where: { shipmentId: payload.shipmentId, ownerDepartment: "operations" },
      select: { id: true },
    });
    if (!steps.length) return;
    const stepIds = steps.map((s) => s.id);
    const { count } = await prisma.task.updateMany({
      where: { otdStepId: { in: stepIds }, status: "queued" },
      data: { assigneeId: payload.ownerId, status: "open" },
    });
    if (!count) return;
    const tasks = await prisma.task.findMany({ where: { otdStepId: { in: stepIds }, assigneeId: payload.ownerId, status: "open" } });
    for (const t of tasks) emitToUser(payload.ownerId, "task:assigned", t);
    await notifyUsers([payload.ownerId], {
      type: "task.assigned",
      title: `${payload.shipmentRef} is yours`,
      body: `${count} operations task${count > 1 ? "s" : ""} moved to your list.`,
      actionUrl: "/admin/tasks",
      priority: 1,
    });
  },

  // Released back to the pool — its operations tasks go back to the queue so the
  // next person to claim the shipment inherits them.
  "shipment.released": async (payload) => {
    const steps = await prisma.otdStep.findMany({
      where: { shipmentId: payload.shipmentId, ownerDepartment: "operations" },
      select: { id: true },
    });
    if (!steps.length) return;
    await prisma.task.updateMany({
      where: { otdStepId: { in: steps.map((s) => s.id) }, status: { in: ["open", "in_progress"] } },
      data: { assigneeId: null, status: "queued" },
    });
    await notifyUsers(await usersWithRole("ops_manager", "ops_exec"), {
      type: "shipment.released",
      title: `${payload.shipmentRef} is unclaimed again`,
      body: "Its operations tasks are back in the queue — claim it to pick the job up.",
      actionUrl: "/admin/shipments",
      priority: 1,
    });
  },

  // Documents. Most changes ride the socket fan-out alone — nobody needs a bell for
  // an upload they made themselves. Two cases DO need telling, and both are the
  // Rate Confirmation gate on Order Lock:
  //
  //   the customer uploads a signed copy  → the ops owner has to verify it before
  //                                         the order can lock, and will not know
  //                                         it landed otherwise
  //   ops rejects a signed copy           → the customer has to send a corrected
  //                                         one, and the reason is the whole message
  "shipment.documents.changed": async (payload) => {
    // The customer's signed quotation (ADR-056) lives on the QUOTATION, not a shipment
    // — there is no shipment yet; verifying it is what creates one. Ops has to hear
    // that a copy landed, and the uploader has to hear if it was refused.
    if (payload.ownerType === "quotation" && payload.docType === "quotation_acceptance") {
      const quotation = await prisma.quotation.findUnique({
        where: { id: payload.ownerId },
        select: { id: true, referenceNo: true, queryId: true, query: { select: { customerId: true } } },
      });
      if (!quotation) return;
      if (payload.change === "upload") {
        await notifyUsers(await usersWithRole("ops_manager", "ops_exec"), {
          type: "document.awaiting_verification",
          title: `Signed acceptance uploaded for ${quotation.referenceNo}`,
          body: "Verify it to create the shipment — or reject it if it is not the customer's signed copy.",
          actionUrl: "/admin/queries",
          priority: 1,
        });
      } else if (payload.change === "reject") {
        const doc = await prisma.document.findUnique({
          where: { id: payload.documentId },
          select: { verificationNote: true, uploadedById: true },
        });
        const customer = await prisma.customer.findUnique({ where: { id: quotation.query.customerId } });
        await notifyUsers([doc?.uploadedById, customer?.assignedBdoId], {
          type: "document.rejected",
          title: `Signed acceptance for ${quotation.referenceNo} not accepted`,
          body: doc?.verificationNote ?? "Ops could not accept it — ask the customer for a clearer signed copy.",
          actionUrl: "/admin/queries",
          priority: 1,
        });
      }
      return;
    }

    if (!payload.shipmentId) return; // master-data paperwork — no workflow gate
    const shipment = await prisma.shipment.findUnique({ where: { id: payload.shipmentId } });
    if (!shipment) return;
    const label = await docTypeLabelFor(payload.docType);

    if (payload.change === "upload" && payload.actorRole === "customer") {
      const types = await prisma.documentType.findMany({
        where: { requiresVerification: true },
        select: { code: true },
      });
      if (!types.some((t) => t.code === payload.docType)) return;
      const targets = shipment.opsOwnerId
        ? [shipment.opsOwnerId]
        : await usersWithRole("ops_manager", "ops_exec");
      await notifyUsers(targets, {
        type: "document.awaiting_verification",
        title: `Signed ${label} uploaded on ${shipment.referenceNo}`,
        body: "Verify it to lock the order.",
        actionUrl: `/admin/shipments/${shipment.id}`,
        priority: 1,
      });
      return;
    }

    if (payload.change === "reject") {
      const doc = await prisma.document.findUnique({
        where: { id: payload.documentId },
        select: { verificationNote: true },
      });
      const customer = await prisma.customer.findUnique({ where: { id: shipment.customerId } });
      const targets = [
        ...(await customerPortalUsers(shipment.customerId)),
        customer?.assignedBdoId,
      ];
      await notifyUsers(targets, {
        type: "document.rejected",
        title: `${label} not accepted on ${shipment.referenceNo}`,
        body: doc?.verificationNote ?? "Please send a corrected copy.",
        actionUrl: "/dashboard",
        priority: 1,
      });
    }
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

  // Ops price it; Sales owns the relationship behind it. A query raised on the
  // storefront by a customer who signed up minutes ago has no BDO yet, so it goes to
  // the whole Sales floor as claimable work rather than to nobody (§5.20).
  "query.created": async (payload) => {
    await notifyUsers(await usersWithRole("ops_manager", "ops_exec"), {
      type: "query.created",
      title: `New query ${payload.referenceNo}`,
      body: `Services: ${(payload.services ?? []).join(", ")}`,
      actionUrl: "/admin/queries",
    });

    const customer = payload.customerId
      ? await prisma.customer.findUnique({ where: { id: payload.customerId } })
      : null;
    const services = (payload.services ?? []).join(", ");

    if (customer?.assignedBdoId) {
      await notifyUsers([customer.assignedBdoId], {
        type: "query.created",
        title: `New query ${payload.referenceNo} from your customer`,
        body: `Services: ${services}`,
        actionUrl: "/admin/queries",
        priority: 1,
      });
    } else {
      await notifyUsers(await usersWithRole("asm", "bdo"), {
        type: "query.created",
        title: `Unclaimed query ${payload.referenceNo}`,
        body: `${services || "A new request"} — no BDO assigned yet. Claim it in Queries.`,
        actionUrl: "/admin/queries",
        priority: 1,
      });
    }
  },

  // A BDO picked an unclaimed query up — it is theirs now, and everyone else's pool
  // just shrank. The other BDOs' lists are refreshed by the fan-out row below; Ops
  // is told because they now know who to send the quote to for a decision.
  "query.claimed": async (payload) => {
    const claimer = payload.claimedById
      ? await prisma.user.findUnique({
          where: { id: payload.claimedById },
          select: { email: true, employee: { select: { firstName: true, lastName: true } } },
        })
      : null;
    const who = claimer?.employee
      ? `${claimer.employee.firstName} ${claimer.employee.lastName}`
      : claimer?.email ?? "a BDO";
    await notifyUsers(await usersWithRole("ops_manager", "ops_exec"), {
      type: "query.claimed",
      title: `Query ${payload.referenceNo} claimed`,
      body: `${who} owns it now — the quote decision goes to them.`,
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
  // The people who may DECIDE on it: the portal customer, the customer's BDO, and —
  // for a website query — the web_manager who owns that channel. An unclaimed
  // customer (storefront signup, bank-LC conversion) has no BDO yet, so the whole
  // Sales floor is told the quote is waiting on a claim.
  "quotation.sent": async (payload) => {
    const query = await prisma.query.findUnique({ where: { id: payload.queryId } });
    if (!query) return;
    const customer = await prisma.customer.findUnique({ where: { id: query.customerId } });
    const targets = [
      ...(await customerPortalUsers(query.customerId)),
      customer?.assignedBdoId,
      ...(query.raisedVia === "portal" ? await usersWithRole("web_manager") : []),
    ];
    await notifyUsers(targets, {
      type: "quotation.sent",
      title: `Quotation ${payload.referenceNo} sent`,
      body: "A quotation is ready for a decision.",
      actionUrl: "/admin/queries",
      priority: 1,
    });
    if (customer && !customer.assignedBdoId) {
      await notifyUsers(await usersWithRole("bdo", "asm"), {
        type: "quotation.sent",
        title: `Unclaimed quote ${payload.referenceNo} awaits a decision`,
        body: `Query ${query.referenceNo} has no BDO — claim it in Queries to decide on the customer's behalf.`,
        actionUrl: "/admin/queries",
        priority: 1,
      });
    }
  },

  "quotation.rejected": async (payload) => {
    await notifyUsers(await usersWithRole("ops_manager", "ops_exec"), {
      type: "quotation.rejected",
      title: `Quotation ${payload.referenceNo} rejected`,
      body: "The customer requested a revision.",
      actionUrl: "/admin/quotations",
    });
  },

  // ── Sales recorded the customer's verbal yes (ADR-056). Not an order yet: Ops is
  //    told an order is EXPECTED so it can plan, and told again if the link lapses. ──
  "quotation.acceptance_claimed": async (payload) => {
    const until = payload.expiresAt ? new Date(payload.expiresAt).toLocaleDateString() : "it expires";
    await notifyUsers(await usersWithRole("ops_manager", "ops_exec"), {
      type: "quotation.acceptance_claimed",
      title: `Expected order — ${payload.referenceNo}`,
      body: `Sales says the customer accepted (${payload.via}). Nothing to do until the customer confirms through their link, or a signed copy is verified.`,
      actionUrl: "/admin/queries",
      priority: 0,
    });
    await notifyUsers([payload.claimedById], {
      type: "quotation.acceptance_claimed",
      title: `Acceptance recorded for ${payload.referenceNo}`,
      body: `The customer's link is live until ${until}. The shipment is created the moment they confirm.`,
      actionUrl: "/admin/queries",
      priority: 0,
    });
  },

  "quotation.acceptance_lapsed": async (payload) => {
    const targets = [payload.claimedById, ...(await usersWithRole("ops_manager", "ops_exec"))];
    await notifyUsers(targets, {
      type: "quotation.acceptance_lapsed",
      title: `${payload.referenceNo} — customer never confirmed`,
      body: "The approval link expired unused. Record the acceptance again to send a fresh link, or ask for a signed copy.",
      actionUrl: "/admin/queries",
      priority: 1,
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
    // The receipt (ADR-056): the customer's portal users and their BDO are told the
    // acceptance was recorded and what it created. Before this only Ops heard, so a
    // wrongly recorded approval produced no signal to the one party who would know.
    const customer = payload.customerId
      ? await prisma.customer.findUnique({ where: { id: payload.customerId }, select: { assignedBdoId: true } })
      : null;
    await notifyUsers(await customerPortalUsers(payload.customerId), {
      type: "quotation.approved",
      title: `You approved quotation ${payload.quotationRef ?? ""}`.trim(),
      body: `Consort has started shipment ${payload.shipmentRef}. If you did not approve this, contact Consort immediately.`,
      actionUrl: "/dashboard",
      priority: 1,
    });
    await notifyUsers([customer?.assignedBdoId], {
      type: "quotation.approved",
      title: `Customer approved — shipment ${payload.shipmentRef} created`,
      body: `Approved via ${payload.approvalChannel ?? "the customer"}.`,
      actionUrl: "/admin/queries",
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

  // The registers were linked, or the path was recomposed (ADR-057). Re-raising the
  // first task is idempotent (RULE-AE-04): a task that already exists is a no-op, a
  // freshly recomposed path gets its first one.
  "shipment.updated": async (payload) => {
    await createNextStepTask(payload.shipmentId);
    const rooms = [`shipment:${payload.shipmentId}`];
    if (payload.customerId) rooms.push(`customer:${payload.customerId}`);
    emitToRooms(rooms, "shipment:updated", { shipmentId: payload.shipmentId });
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

  // ── Trade alerts (roadmap §7.2) ─────────────────────────────────────────────
  // The nightly sweeps have detected these for a while, but nothing consumed the
  // events, so an instrument could expire and a DA payment fall due with no one
  // told. Accounts owns the money; Operations owns the shipment it sits on.

  "fi.expiring": async (payload) => {
    const shipment = await prisma.shipment.findFirst({
      where: { financialInstrumentId: payload.financialInstrumentId },
      select: { id: true, referenceNo: true, opsOwnerId: true },
    });
    const targets = [
      ...(await usersWithRole("accounts")),
      ...(shipment?.opsOwnerId ? [shipment.opsOwnerId] : await usersWithRole("ops_manager", "ops_exec")),
    ];
    await notifyUsers(targets, {
      type: "fi.expiring",
      title: payload.expired
        ? `Financial Instrument ${payload.fiNumber} has expired`
        : `Financial Instrument ${payload.fiNumber} expires in ${payload.daysLeft} day(s)`,
      body: shipment
        ? `On shipment ${shipment.referenceNo}. Nothing can be drawn against an expired instrument.`
        : "Not yet attached to a shipment.",
      actionUrl: shipment ? `/admin/shipments/${shipment.id}` : "/admin/trade",
      priority: payload.expired ? 2 : 1,
    });
  },

  "fi.da_due": async (payload) => {
    const shipment = payload.shipmentId
      ? await prisma.shipment.findUnique({
          where: { id: payload.shipmentId },
          select: { id: true, referenceNo: true, opsOwnerId: true },
        })
      : null;
    const overdue = (payload.daysLeft ?? 0) < 0;
    const due = new Date(payload.dueDate).toISOString().slice(0, 10);
    const targets = [
      ...(await usersWithRole("accounts")),
      ...(shipment?.opsOwnerId ? [shipment.opsOwnerId] : []),
    ];
    await notifyUsers(targets, {
      type: "fi.da_due",
      title: overdue
        ? `DA payment overdue by ${Math.abs(payload.daysLeft)} day(s)`
        : `DA payment due in ${payload.daysLeft} day(s)`,
      body: `B/L ${payload.blNumber ?? "—"} — due ${due}. Computed from the shipped-on-board date, not typed in.`,
      actionUrl: shipment ? `/admin/shipments/${shipment.id}` : "/admin/trade",
      priority: overdue ? 2 : 1,
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
