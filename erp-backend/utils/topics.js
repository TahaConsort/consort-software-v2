/**
 * Invalidation topics — the shared vocabulary of "what changed".
 *
 * A topic is a coarse name for a slice of state. The outbox relay turns each
 * dispatched event into a `data:changed` socket payload carrying nothing but a
 * list of these strings; the client maps them back to the stores that must
 * re-read. No entity data travels on the wire, so a topic broadcast is safe to
 * send to a role or department room (ADR-007: events are hints, never state).
 *
 * MIRRORED in `erp-frontend/src/lib/topics.js`. The two files must stay
 * identical — a topic the server emits that the client doesn't know is a silent
 * no-op. `scripts/verifyEventTopics.js` guards this.
 *
 * Entity-scoped topics are `TOPIC:id` (e.g. `shipment:abc`). The client matches
 * by prefix as well as exact string, so emitting `shipments` refreshes the list
 * screens while `shipment:abc` refreshes only that shipment's detail.
 */

export const TOPICS = {
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
  AUDIT: "audit",
  ACTION_ENGINE: "actionEngine",
  DASHBOARD: "dashboard",
  CHAT: "chat",
  WORKFLOW: "workflow",

  // Entity-scoped prefixes — always used via the builders below.
  SHIPMENT: "shipment",
  DOCUMENTS: "documents",
  CHAT_CHANNEL: "chatChannel",
  LEAD: "lead",
};

export const shipmentTopic = (id) => `${TOPICS.SHIPMENT}:${id}`;
export const documentsTopic = (ownerType, ownerId) => `${TOPICS.DOCUMENTS}:${ownerType}:${ownerId}`;
export const chatChannelTopic = (id) => `${TOPICS.CHAT_CHANNEL}:${id}`;
export const leadTopic = (id) => `${TOPICS.LEAD}:${id}`;

/** Every bare topic string, for the mirror check. */
export const ALL_TOPICS = Object.values(TOPICS);

/**
 * True if `topic` is a known topic — either a bare name or an entity-scoped one
 * whose prefix is known. Used by verifyEventTopics.js to catch typos in the
 * event→topic table before they become events that invalidate nothing.
 */
export const isKnownTopic = (topic) => {
  if (typeof topic !== "string" || !topic) return false;
  if (ALL_TOPICS.includes(topic)) return true;
  const prefix = topic.split(":")[0];
  return ALL_TOPICS.includes(prefix);
};
