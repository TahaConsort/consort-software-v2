import {
  chatChannelTopic, documentsTopic, leadTopic, shipmentTopic, TOPICS,
} from "./topics.js";

/**
 * Event → invalidation fan-out (ADR-007/ADR-020).
 *
 * One declarative row per outbox eventType saying WHAT the event dirties and WHO should
 * hear about it. The relay reads this table once per dispatched event and emits a single
 * `data:changed` carrying only topic strings; the client maps them back to the stores that
 * must re-read.
 *
 * The point of a table rather than 37 hand-written emits is that the handlers were already
 * doing the hard part — every notification-only handler computes exactly the role set a
 * broadcast wants — and 29 of them still pushed nothing to any room. Lifting the audience
 * up here makes the fan-out mechanical: adding an event later is adding a row.
 *
 * The `role:{role}` and `dept:{id}` rooms are auto-joined by every socket
 * (realtime/socket.js) and, before this, had zero emitters anywhere in the backend.
 *
 * Nothing here carries entity data. A topic is a name, so broadcasting one to a role room
 * leaks nothing — which is what makes the wide audiences below safe.
 *
 *   topics : (payload) => string[]   what to re-read
 *   roles  : string[]                role rooms that should hear it
 *   scoped : (payload) => string[]   extra rooms (shipment/customer/channel)
 *
 * `customer:{id}` is included ONLY where the change is the customer's to see (INV-10) —
 * an internal-only document is not portal news, and telling the portal "something changed"
 * when it would then refetch and see nothing is a weak side channel, not a feature.
 */

// Exactly the role keys in auth.middleware.js ROLE_PERMISSIONS — a typo here would
// broadcast to a room nobody is in, which is silent. verifyEventTopics.js checks them.
const OPS = ["ops_manager", "ops_exec"];
const SALES = ["asm", "bdo"];
const MGMT = ["ceo", "project_director", "director", "cfo", "gm"];
const FINANCE = ["accounts"];
const COMPLIANCE = ["compliance_manager", "compliance_exec"];
const TRANSPORT = ["transport_manager", "transport_exec"];
// `customer` is deliberately absent: the portal hears only through `customer:{id}`, which
// each row opts into explicitly (INV-10).
const ALL_INTERNAL = [...new Set([...OPS, ...SALES, ...MGMT, ...FINANCE, ...COMPLIANCE, ...TRANSPORT, "hr"])];

const shipmentScoped = (p) => [
  ...(p.shipmentId ? [`shipment:${p.shipmentId}`] : []),
  ...(p.customerId ? [`customer:${p.customerId}`] : []),
];

/** A shipment's own detail plus every list that shows shipment state. */
const shipmentTopics = (p) => [
  ...(p.shipmentId ? [shipmentTopic(p.shipmentId)] : []),
  TOPICS.SHIPMENTS,
  TOPICS.DASHBOARD,
];

export const EVENT_TOPICS = {
  /* ── Leads ─────────────────────────────────────────────────────────────── */
  "lead.created": { topics: () => [TOPICS.LEADS, TOPICS.DASHBOARD], roles: SALES },
  "lead.updated": { topics: (p) => [TOPICS.LEADS, leadTopic(p.leadId), TOPICS.DASHBOARD], roles: SALES },
  "lead.status_changed": { topics: (p) => [TOPICS.LEADS, leadTopic(p.leadId), TOPICS.DASHBOARD], roles: SALES },
  // Conversion mints a customer, which four other screens list.
  "lead.converted": {
    topics: (p) => [TOPICS.LEADS, leadTopic(p.leadId), TOPICS.CUSTOMERS, TOPICS.DASHBOARD],
    roles: [...SALES, ...MGMT],
  },
  "lead.stale": { topics: () => [TOPICS.LEADS, TOPICS.DASHBOARD], roles: SALES },

  /* ── Outreach & visits ─────────────────────────────────────────────────── */
  // A touch can advance the lead machine, so leads move with it.
  "outreach.logged": { topics: () => [TOPICS.OUTREACH, TOPICS.LEADS, TOPICS.DASHBOARD], roles: SALES },
  "visit.scheduled": { topics: () => [TOPICS.VISITS, TOPICS.DASHBOARD], roles: SALES },
  "visit.completed": { topics: () => [TOPICS.VISITS, TOPICS.OUTREACH, TOPICS.LEADS, TOPICS.DASHBOARD], roles: SALES },
  "visit.no_show": { topics: () => [TOPICS.VISITS, TOPICS.OUTREACH, TOPICS.LEADS, TOPICS.DASHBOARD], roles: SALES },
  "visit.cancelled": { topics: () => [TOPICS.VISITS, TOPICS.DASHBOARD], roles: SALES },

  /* ── Customers ─────────────────────────────────────────────────────────── */
  "customer.registered": { topics: () => [TOPICS.CUSTOMERS, TOPICS.DASHBOARD], roles: [...SALES, ...MGMT] },
  "customer.updated": { topics: () => [TOPICS.CUSTOMERS, TOPICS.DASHBOARD], roles: [...SALES, ...OPS, ...FINANCE] },
  // A portal user is a User row, so the employee/user admin list changes too.
  "customer.invited": { topics: () => [TOPICS.CUSTOMERS, TOPICS.EMPLOYEES, TOPICS.DASHBOARD], roles: SALES },

  /* ── Queries ───────────────────────────────────────────────────────────── */
  "query.created": { topics: () => [TOPICS.QUERIES, TOPICS.DASHBOARD], roles: [...OPS, ...SALES] },
  "query.updated": { topics: () => [TOPICS.QUERIES, TOPICS.DASHBOARD], roles: OPS },
  "query.cancelled": { topics: () => [TOPICS.QUERIES, TOPICS.QUOTATIONS, TOPICS.DASHBOARD], roles: [...OPS, ...SALES] },
  "query.hazardous": { topics: () => [TOPICS.QUERIES, TOPICS.TASKS, TOPICS.DASHBOARD], roles: [...OPS, ...COMPLIANCE] },
  "query.stale": { topics: () => [TOPICS.QUERIES, TOPICS.DASHBOARD], roles: [...OPS, ...SALES] },
  "query.expired": { topics: () => [TOPICS.QUERIES, TOPICS.DASHBOARD], roles: [...OPS, ...SALES] },

  /* ── Quotations ────────────────────────────────────────────────────────── */
  "quotation.created": { topics: () => [TOPICS.QUOTATIONS, TOPICS.QUERIES, TOPICS.DASHBOARD], roles: OPS },
  "quotation.updated": { topics: () => [TOPICS.QUOTATIONS, TOPICS.QUERIES, TOPICS.DASHBOARD], roles: OPS },
  "quotation.sent": {
    topics: () => [TOPICS.QUOTATIONS, TOPICS.QUERIES, TOPICS.DASHBOARD],
    roles: [...OPS, ...SALES],
    // The customer is being shown a quote — this is precisely their business.
    scoped: (p) => (p.customerId ? [`customer:${p.customerId}`] : []),
  },
  "quotation.rejected": { topics: () => [TOPICS.QUOTATIONS, TOPICS.QUERIES, TOPICS.DASHBOARD], roles: [...OPS, ...SALES] },
  // RULE-QT-07: approval creates the shipment, composes the OTD path and seeds tasks.
  // The widest fan-out in the app.
  "quotation.approved": {
    topics: (p) => [
      TOPICS.QUOTATIONS, TOPICS.QUERIES, TOPICS.SHIPMENTS, TOPICS.TASKS,
      TOPICS.INVOICES, TOPICS.DASHBOARD,
      ...(p.shipmentId ? [shipmentTopic(p.shipmentId)] : []),
    ],
    roles: ALL_INTERNAL,
    scoped: shipmentScoped,
  },
  "quotation.expiring": { topics: () => [TOPICS.QUOTATIONS, TOPICS.DASHBOARD], roles: [...OPS, ...MGMT] },
  "quotation.expired": { topics: () => [TOPICS.QUOTATIONS, TOPICS.QUERIES, TOPICS.DASHBOARD], roles: [...OPS, ...MGMT] },

  /* ── Shipments ─────────────────────────────────────────────────────────── */
  "shipment.created": { topics: shipmentTopics, roles: ALL_INTERNAL, scoped: shipmentScoped },
  "shipment.held": { topics: (p) => [...shipmentTopics(p), TOPICS.TASKS], roles: ALL_INTERNAL, scoped: shipmentScoped },
  "shipment.resumed": { topics: (p) => [...shipmentTopics(p), TOPICS.TASKS], roles: ALL_INTERNAL, scoped: shipmentScoped },
  "shipment.cancelled": { topics: (p) => [...shipmentTopics(p), TOPICS.TASKS, TOPICS.INVOICES], roles: ALL_INTERNAL, scoped: shipmentScoped },
  "shipment.closed": { topics: (p) => [...shipmentTopics(p), TOPICS.INVOICES], roles: ALL_INTERNAL, scoped: shipmentScoped },
  "shipment.scheduled": { topics: (p) => [...shipmentTopics(p), TOPICS.TASKS], roles: ALL_INTERNAL, scoped: shipmentScoped },
  "shipment.eta_breached": { topics: shipmentTopics, roles: [...OPS, ...MGMT], scoped: shipmentScoped },

  /* ── OTD steps ─────────────────────────────────────────────────────────── */
  // A step's sub-action tick or notes edit changes only that shipment's gating.
  "shipment.step.updated": {
    topics: (p) => (p.shipmentId ? [shipmentTopic(p.shipmentId)] : []),
    roles: [],
    scoped: (p) => (p.shipmentId ? [`shipment:${p.shipmentId}`] : []),
  },

  /* ── OTC milestones ────────────────────────────────────────────────────── */
  // Can flip the shipment to `settled` and lock the whole order (RULE-SH-12).
  "otc.milestone.completed": {
    topics: (p) => [...shipmentTopics(p), TOPICS.INVOICES],
    roles: [...OPS, ...FINANCE, ...MGMT],
    scoped: shipmentScoped,
  },

  /* ── Documents ─────────────────────────────────────────────────────────── */
  // RULE-SH-06: a document changes whether a step can be completed, and the server
  // derives that at read time — so without this event an upload by one user was
  // invisible to everyone else's open stepper.
  "shipment.documents.changed": {
    topics: (p) => [
      ...(p.ownerType && p.ownerId ? [documentsTopic(p.ownerType, p.ownerId)] : []),
      ...(p.shipmentId ? [shipmentTopic(p.shipmentId)] : []),
      TOPICS.SHIPMENTS,
    ],
    roles: [],
    scoped: shipmentScoped,
  },

  /* ── Tasks ─────────────────────────────────────────────────────────────── */
  "task.assigned": { topics: () => [TOPICS.TASKS, TOPICS.NOTIFICATIONS], roles: ALL_INTERNAL },
  "task.completed": { topics: (p) => [TOPICS.TASKS, ...shipmentTopics(p)], roles: ALL_INTERNAL, scoped: shipmentScoped },
  "task.unassigned": { topics: () => [TOPICS.TASKS, TOPICS.NOTIFICATIONS], roles: [...MGMT, ...OPS] },
  "task.overdue": { topics: () => [TOPICS.TASKS, TOPICS.NOTIFICATIONS, TOPICS.DASHBOARD], roles: ALL_INTERNAL },
  "task.reassigned": { topics: () => [TOPICS.TASKS, TOPICS.NOTIFICATIONS], roles: ALL_INTERNAL },

  /* ── Finance ───────────────────────────────────────────────────────────── */
  "invoice.created": { topics: (p) => [TOPICS.INVOICES, ...shipmentTopics(p)], roles: [...FINANCE, ...OPS, ...MGMT], scoped: shipmentScoped },
  "invoice.issued": {
    topics: (p) => [TOPICS.INVOICES, ...shipmentTopics(p)],
    roles: [...FINANCE, ...OPS, ...MGMT],
    // An issued invoice is addressed to the customer.
    scoped: shipmentScoped,
  },
  "invoice.voided": { topics: (p) => [TOPICS.INVOICES, ...shipmentTopics(p)], roles: [...FINANCE, ...OPS, ...MGMT], scoped: shipmentScoped },
  "payment.received": { topics: (p) => [TOPICS.INVOICES, ...shipmentTopics(p)], roles: [...FINANCE, ...OPS, ...MGMT], scoped: shipmentScoped },
  "invoice.overdue": { topics: () => [TOPICS.INVOICES, TOPICS.DASHBOARD], roles: [...FINANCE, ...MGMT] },

  /* ── Intake channels ───────────────────────────────────────────────────── */
  "inquiry.received": { topics: () => [TOPICS.INQUIRIES, TOPICS.DASHBOARD], roles: [...SALES, ...MGMT] },
  "inquiry.updated": { topics: () => [TOPICS.INQUIRIES], roles: SALES },
  "inquiry.converted": {
    topics: () => [TOPICS.INQUIRIES, TOPICS.LEADS, TOPICS.QUERIES, TOPICS.CUSTOMERS, TOPICS.DASHBOARD],
    roles: [...SALES, ...OPS],
  },
  "lc.received": { topics: () => [TOPICS.LC_REFERRALS, TOPICS.DASHBOARD], roles: [...OPS, ...COMPLIANCE] },
  "lc.updated": { topics: () => [TOPICS.LC_REFERRALS], roles: [...OPS, ...COMPLIANCE] },
  "lc.converted": {
    topics: () => [TOPICS.LC_REFERRALS, TOPICS.QUERIES, TOPICS.CUSTOMERS, TOPICS.DASHBOARD],
    roles: [...OPS, ...SALES, ...COMPLIANCE],
  },

  /* ── Admin catalog & people ────────────────────────────────────────────── */
  // ADR-051: the docType vocabulary and step templates feed every upload picker and
  // every docType label in the app, in every open session.
  "workflow.catalog.changed": { topics: () => [TOPICS.WORKFLOW], roles: ALL_INTERNAL },
  "user.created": { topics: () => [TOPICS.EMPLOYEES], roles: [...MGMT, "hr"] },
  "user.updated": { topics: () => [TOPICS.EMPLOYEES, TOPICS.TASKS], roles: [...MGMT, "hr"] },
  "user.deactivated": { topics: () => [TOPICS.EMPLOYEES, TOPICS.TASKS], roles: [...MGMT, "hr"] },
  "vendor.changed": { topics: () => [TOPICS.VENDORS], roles: [...FINANCE, ...OPS, ...MGMT] },

  /* ── Vendor RFQs (buy side) ────────────────────────────────────────────────
     Each also carries QUERIES, because the queries list shows a per-query
     "vendor quotes in" chip that goes stale the moment an RFQ moves. */
  "rfq.created": { topics: () => [TOPICS.RFQS, TOPICS.QUERIES], roles: [...OPS, ...MGMT] },
  "rfq.updated": { topics: () => [TOPICS.RFQS, TOPICS.QUERIES], roles: [...OPS, ...MGMT] },
  "rfq.quote_received": { topics: () => [TOPICS.RFQS, TOPICS.QUERIES], roles: [...OPS, ...MGMT] },
  "rfq.awarded": { topics: () => [TOPICS.RFQS, TOPICS.QUERIES, TOPICS.DASHBOARD], roles: [...OPS, ...MGMT] },
  "loadboard.changed": { topics: () => [TOPICS.LOADBOARD], roles: [...SALES, ...OPS] },

  /* ── Observability ─────────────────────────────────────────────────────── */
  "action.unroutable": { topics: () => [TOPICS.ACTION_ENGINE, TOPICS.NOTIFICATIONS], roles: MGMT },
};

/**
 * The step-completion events carry the step code as a suffix
 * (`shipment.step.completed:vessel_booked`), so they are matched by prefix — the same way
 * the relay's own PREFIX_HANDLERS work.
 */
export const EVENT_TOPIC_PREFIXES = {
  "shipment.step.completed:": {
    topics: (p) => [...shipmentTopics(p), TOPICS.TASKS, TOPICS.INVOICES],
    roles: ALL_INTERNAL,
    scoped: shipmentScoped,
  },
  "shipment.step.reopened:": {
    topics: (p) => [...shipmentTopics(p), TOPICS.TASKS],
    roles: ALL_INTERNAL,
    scoped: shipmentScoped,
  },
};

/** Chat bypasses the outbox and emits directly, so it is not in the table. */
export const CHAT_TOPICS = (channelId) => [TOPICS.CHAT, chatChannelTopic(channelId)];

const resolveEntry = (eventType) => {
  if (EVENT_TOPICS[eventType]) return EVENT_TOPICS[eventType];
  for (const [prefix, entry] of Object.entries(EVENT_TOPIC_PREFIXES)) {
    if (eventType.startsWith(prefix)) return entry;
  }
  return null;
};

/**
 * Resolve one event into `{ topics, rooms }` for a single `data:changed` emit.
 * Returns null for an event with no row, so the caller can log it rather than
 * silently invalidating nothing.
 */
export const fanOutFor = (eventType, payload = {}) => {
  const entry = resolveEntry(eventType);
  if (!entry) return null;

  const topics = [...new Set((entry.topics?.(payload) ?? []).filter(Boolean))];
  const rooms = [
    ...(entry.roles ?? []).map((role) => `role:${role}`),
    ...(entry.scoped?.(payload) ?? []),
  ];
  if (!topics.length || !rooms.length) return null;
  return { topics, rooms: [...new Set(rooms)] };
};

/** Every eventType the table knows, for scripts/verifyEventTopics.js. */
export const KNOWN_EVENT_TYPES = [
  ...Object.keys(EVENT_TOPICS),
  ...Object.keys(EVENT_TOPIC_PREFIXES),
];
