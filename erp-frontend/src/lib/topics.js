/**
 * Invalidation topics — the shared vocabulary of "what changed".
 *
 * A topic is a coarse name for a slice of server state. Stores declare which
 * topics they own; mutations declare which topics they dirty; the backend puts
 * the same strings on the wire in `data:changed`. That is the whole contract —
 * a topic carries no data, only "re-read this".
 *
 * MIRRORED in `erp-backend/utils/topics.js`. The two files must stay identical:
 * a topic the server emits that the client doesn't know is a silent no-op.
 * `scripts/verifyEventTopics.js` guards this.
 *
 * Entity-scoped topics are `TOPIC:id` (e.g. `shipment:abc`). The bus matches by
 * prefix as well as exact string, so invalidating `shipment` refreshes every
 * per-shipment subscriber, while `shipment:abc` refreshes only that one.
 */

export const TOPICS = {
  // Collections — one topic per list screen.
  LEADS: "leads",
  CUSTOMERS: "customers",
  QUERIES: "queries",
  QUOTATIONS: "quotations",
  SHIPMENTS: "shipments",
  TASKS: "tasks",
  INVOICES: "invoices",
  VISITS: "visits",
  OUTREACH: "outreach",
  INQUIRIES: "inquiries",
  LC_REFERRALS: "lcReferrals",
  NOTIFICATIONS: "notifications",
  EMPLOYEES: "employees",
  VENDORS: "vendors",
  RFQS: "rfqs",
  LOADBOARD: "loadboard",
  AUDIT: "audit",
  ACTION_ENGINE: "actionEngine",
  REPORTS: "reports",
  DASHBOARD: "dashboard",
  CHAT: "chat",

  // The admin-managed catalog: step templates, checklists, docType vocabulary
  // (ADR-051). Editing it changes pickers and labels app-wide.
  WORKFLOW: "workflow",

  // Entity-scoped prefixes — always used via the builders below.
  SHIPMENT: "shipment",
  DOCUMENTS: "documents",
  CHAT_CHANNEL: "chatChannel",
  LEAD: "lead",
};

/** `shipment:{id}` — one shipment's detail aggregate (steps, milestones, invoices, P&L). */
export const shipmentTopic = (id) => `${TOPICS.SHIPMENT}:${id}`;

/** `documents:{ownerType}:{ownerId}` — the document list + required-doc checklist of one owner. */
export const documentsTopic = (ownerType, ownerId) => `${TOPICS.DOCUMENTS}:${ownerType}:${ownerId}`;

/** `chatChannel:{id}` — one channel's message list. */
export const chatChannelTopic = (id) => `${TOPICS.CHAT_CHANNEL}:${id}`;

/** `lead:{id}` — one lead's detail aggregate (status history + outreach). */
export const leadTopic = (id) => `${TOPICS.LEAD}:${id}`;

/** Every topic string the client understands, for the mirror check. */
export const ALL_TOPICS = Object.values(TOPICS);

/**
 * True if `topic` is invalidated by `changed`. Exact match, or `changed` is the
 * bare prefix of an entity-scoped topic ("shipment" dirties "shipment:abc").
 * Deliberately NOT the other way round: `shipment:abc` must not touch `shipment:xyz`.
 */
export const topicMatches = (topic, changed) =>
  topic === changed || topic.startsWith(`${changed}:`);
