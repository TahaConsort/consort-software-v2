/**
 * The Phase-1 service catalog (ADR-041, CRM_MASTER §5.6a). A query's `services` is free
 * text now, so this is the SUGGESTED list the pickers offer — not a closed set. Anything
 * not in it renders as the raw string.
 */
export const SERVICE_LABELS = {
  local_transport: "Local Transport / Inland",
  customs_clearance: "Customs Clearance",
  sea_freight: "Sea Freight (Ocean)",
  rail_freight: "Rail Freight",
  port_handling: "Port Handling / Terminal",
  lc_finance: "LC / Trade Finance",
  destination_services: "Destination Services / Agent",
};

export const SERVICE_OPTIONS = Object.entries(SERVICE_LABELS).map(([value, label]) => ({ value, label }));

export const labelForService = (code) => SERVICE_LABELS[code] ?? code;

/**
 * The two movement axes on a query. Deliberately separate questions: mode is how the
 * goods travel, scope is how far they go. A rail move can be domestic or an export, and
 * trucking to Kabul is road but not domestic, so neither derives from the other.
 *
 * Mirrors TransportMode / MovementScope in the Prisma schema and the vocabularies in
 * erp-backend/utils/movement.js; keep the two in step.
 */
export const TRANSPORT_MODE_LABELS = {
  sea: "Sea",
  road: "Road",
  rail: "Rail",
};

export const MOVEMENT_SCOPE_LABELS = {
  domestic: "Domestic",
  export: "Export",
  import: "Import",
};

export const TRANSPORT_MODE_OPTIONS = Object.entries(TRANSPORT_MODE_LABELS).map(
  ([value, label]) => ({ value, label }),
);
export const MOVEMENT_SCOPE_OPTIONS = Object.entries(MOVEMENT_SCOPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export const labelForMode = (code) => TRANSPORT_MODE_LABELS[code] ?? code;
export const labelForScope = (code) => MOVEMENT_SCOPE_LABELS[code] ?? code;

/**
 * The services each mode normally sells. A SUGGESTION that reorders and pre-ticks the
 * query form's checkboxes, never a restriction: services stay free text on the wire, and
 * a real job regularly needs something off its mode's list.
 *
 * Mirrors SERVICES_BY_MODE in erp-backend/utils/movement.js.
 */
export const SERVICES_BY_MODE = {
  sea: ["sea_freight", "port_handling", "customs_clearance", "local_transport", "lc_finance", "destination_services"],
  rail: ["rail_freight", "local_transport", "customs_clearance"],
  road: ["local_transport", "customs_clearance"],
};

/** The vendor types worth shortlisting per mode when sourcing a rate. Also a suggestion. */
export const VENDOR_TYPES_BY_MODE = {
  sea: ["shipping_line", "ocean_carrier", "freight_forwarder", "port_terminal", "container_yard", "customs_agent", "destination_agent"],
  rail: ["rail_operator", "rail_terminal", "transporter", "customs_agent"],
  road: ["transporter", "customs_agent"],
};

/** The union of what every selected mode sells, in SERVICE_LABELS order so it reads stably. */
export const servicesForModes = (modes = []) => {
  const wanted = new Set(modes.flatMap((m) => SERVICES_BY_MODE[m] ?? []));
  return Object.keys(SERVICE_LABELS).filter((code) => wanted.has(code));
};

/** The union of the vendor types every selected mode buys from. */
export const vendorTypesForModes = (modes = []) => [
  ...new Set(modes.flatMap((m) => VENDOR_TYPES_BY_MODE[m] ?? [])),
];

/**
 * The route line for a query or shipment: pickup → destination. A query records two
 * free-text addresses now — the service packages, ports and CRO/LC handling modes that
 * used to decide which pair of endpoints to print are gone.
 *
 * Shipments still carry ports, so those win when present and addresses are the fallback.
 */
export const routeOf = (row) => {
  if (!row) return "";
  const from = row.pickupAddress || row.originPort;
  const to = row.destinationAddress || row.deliveryAddress || row.destinationPort;
  return [from, to].filter(Boolean).join(" → ");
};

export const QUERY_STATUS_LABELS = {
  open: "Open",
  quoted: "Quoted",
  revision_requested: "Revision Requested",
  approved: "Approved",
  shipment_created: "Shipment Created",
  rejected: "Rejected",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const VISIT_STATUS_LABELS = {
  planned: "Planned",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

export const QUOTATION_STATUS_LABELS = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

// The three query intake channels (tabs on the Queries screen) and the
// Query.raisedVia value behind each bucket.
export const QUERY_CHANNEL_LABELS = {
  bdo: "BDO",
  bank_lc: "Bank LC",
  website: "Website",
};
export const RAISED_VIA_TO_CHANNEL = { bdo: "bdo", bank_lc: "bank_lc", portal: "website" };

// How the BDO gave a sent quote to the customer (Quotation.sharedVia), and how the
// customer's verbal yes arrived (Quotation.acceptanceClaimedVia) — the same enum.
export const QUOTE_SHARE_CHANNEL_LABELS = {
  email: "Email",
  phone: "Phone",
  whatsapp: "WhatsApp",
  in_person: "In person",
};

// Which of the customer's own acts approved the quotation (Quotation.approvalChannel,
// ADR-056). The three internal values are history: no internal role approves any more.
export const APPROVAL_CHANNEL_LABELS = {
  approval_link: "secure link",
  customer_portal: "customer portal",
  signed_copy: "signed copy",
  bdo: "BDO (legacy)",
  asm: "ASM (legacy)",
  web_manager: "web manager (legacy)",
  management: "management (legacy)",
};

// The derived shipment statuses — a shorter service path only ever reaches its
// own subset (RULE-SVC-03). container_allocated / destination_inspection are
// retired but kept for historical rows.
export const SHIPMENT_STATUS_LABELS = {
  booking: "Booking",
  order_confirmed: "Order Confirmed",
  lc_generated: "LC Generated",
  container_allocated: "Container Allocated",
  vessel_booked: "Vessel Booked",
  cro_released: "CRO Released",
  transporter_assigned: "Transporter Assigned",
  vehicle_dispatched: "Vehicle Dispatched",
  goods_loaded: "Goods Loaded",
  in_transit: "In Transit",
  empty_container_pickup: "Empty Container Picked Up",
  cargo_pickup: "Cargo Picked Up",
  inland_transit: "In Transit to Port",
  customs_entry: "Customs Entry",
  inspected_sealed: "Inspected & Sealed",
  port_handover: "Port Gate-In",
  bol_issued: "BOL Issued",
  bol_submitted: "BOL Submitted",
  telex_released: "Telex Released",
  destination_inspection: "Destination Inspection",
  destination_do: "Delivery Order Issued",
  destination_pickup: "Destination Pickup",
  // Export-trade rungs (roadmap §5 steps 2, 3 and 6)
  packing_confirmed: "Packing Confirmed",
  invoice_raised: "Invoice Raised",
  logistics_settled: "Logistics Settled",
  delivered: "Delivered",
  settled: "Settled",
  closed: "Closed",
};

export const EXCEPTION_STATE_LABELS = {
  none: "Active",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

export const TASK_STATUS_LABELS = {
  queued: "Queued",
  open: "Open",
  in_progress: "In Progress",
  done: "Done",
  cancelled: "Cancelled",
  on_hold: "On Hold",
};

export const OTC_MILESTONE_LABELS = {
  invoice_issued: "Invoice Issued",
  payment_received: "Payment Received",
  credit_line_released: "Credit Line Released",
  bol_surrendered: "BOL Surrendered",
  settlement_complete: "Settlement Complete",
};

/**
 * The trading currency of the business — mirrors DEFAULT_CURRENCY in
 * erp-backend/utils/currency.js. Used for new-record form defaults and as the
 * display fallback when a row somehow carries no currency of its own. Records
 * store their own currency, so anything priced differently still renders correctly.
 */
export const DEFAULT_CURRENCY = "PKR";

// The raw lifecycle status. Kept for screens where the distinction between an
// unissued draft and an issued invoice actually drives an action (the Finance
// filter, for one — collapsing both to "Unpaid" would give it two identical rows).
export const INVOICE_STATUS_LABELS = {
  draft: "Draft",
  issued: "Issued",
  part_paid: "Part Paid",
  paid: "Paid",
  void: "Void",
};

/**
 * How an invoice reads to someone tracking money rather than running the finance
 * desk: is it paid or not? "Draft" answers a question nobody on a shipment page is
 * asking. Draft and issued both mean the money has not arrived, so both read
 * "Unpaid" — `notYetIssued` is carried alongside for the one caller that needs to
 * explain why an unpaid invoice cannot be collected yet.
 */
export const paymentStateOf = (inv) => {
  const paid = (inv?.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const total = Number(inv?.totalAmount ?? 0);
  if (inv?.status === "void") return { key: "void", label: "Void", paid, outstanding: 0, notYetIssued: false };
  if (inv?.status === "paid") return { key: "paid", label: "Paid", paid, outstanding: 0, notYetIssued: false };
  const outstanding = Math.max(0, total - paid);
  const notYetIssued = inv?.status === "draft";
  if (paid > 0) return { key: "part_paid", label: "Partly Paid", paid, outstanding, notYetIssued };
  return { key: "unpaid", label: "Unpaid", paid, outstanding, notYetIssued };
};

/**
 * Whole days an invoice is past its due date, or 0. Only money still owed can be
 * overdue — a paid or voided invoice never is, however old its due date.
 */
export const overdueDaysOf = (inv) => {
  if (!inv?.dueDate || ["paid", "void"].includes(inv?.status)) return 0;
  const ms = Date.now() - new Date(inv.dueDate).getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
};

// The payment states a person filters by, and the raw statuses each covers.
// Draft and issued both mean "not paid", so they share one filter entry.
export const PAYMENT_STATE_FILTERS = [
  { value: "", label: "All invoices", statuses: null },
  { value: "unpaid", label: "Unpaid", statuses: ["draft", "issued"] },
  { value: "part_paid", label: "Partly Paid", statuses: ["part_paid"] },
  { value: "paid", label: "Paid", statuses: ["paid"] },
  { value: "void", label: "Void", statuses: ["void"] },
];

// Badge styling per payment state — green paid, amber partly, red unpaid, muted void.
export const PAYMENT_STATE_CLASS = {
  paid: "bg-green-50 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-300",
  part_paid: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300",
  unpaid: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300",
  void: "bg-muted text-muted-foreground border-muted-foreground/30 line-through",
};

// ── Vendors — the counterparties on payable invoices ──

/**
 * Every value VendorType can hold. This map stays COMPLETE even though only a subset
 * is selectable (below): shipments and the parties panel both render
 * `VENDOR_TYPE_LABELS[v.type]`, so dropping a key here would print a raw enum string
 * on every vendor already filed under it.
 */
export const VENDOR_TYPE_LABELS = {
  // ── The roadmap's party directory (§2/§3) ──
  buyer: "Customer / Importer",
  exporter: "Goods Supplier",
  bank: "Bank",
  ocean_carrier: "Ocean Carrier",
  shipping_line: "Carrier's Agent",
  freight_forwarder: "Freight Forwarder",
  port_terminal: "Port / Container Terminal",
  customs_agent: "Customs Clearing Agent",
  destination_agent: "Destination Agent",
  other: "Other Party",
  // ── Road and rail counterparties, offered since those became selectable modes ──
  transporter: "Transporter",
  rail_operator: "Rail Operator",
  rail_terminal: "Rail / Inland Terminal",
  // ── Rendered on existing rows, never offered ──
  container_yard: "Container Yard",
  driver: "Driver",
  // Air is parked (see TRANSPORT_MODE_LABELS). The enum values stay in the database and
  // the labels stay here, so re-offering air later is a list edit and not a migration.
  airline: "Airline",
  air_cargo_agent: "Air Cargo Agent (IATA)",
  airport_terminal: "Air Cargo Terminal",
};

/**
 * The party types the Export Shipment Workflow roadmap names, ordered by its §3
 * stakeholder table. This is exactly the set `prisma/roadmapParties.js` files its
 * twelve §2 parties under, so the picker and the seeded directory agree.
 *
 * Every value is a pre-existing VendorType, so none of this needs a schema change:
 *  · `exporter` carries "Goods Supplier" — the roadmap classifies Ahmad Saeed Textiles
 *    and Alisha Fatima Textile as Vendors whose ROLE on the shipping documents is
 *    Exporter/Shipper, which is the enum's original meaning.
 *  · `shipping_line` carries "Carrier's Agent" — United Marine Agencies, named on the
 *    HMM card as the agent that issues the B/L for the carrier.
 *  · `other` covers the two §2 parties with no role of their own: Javed Latif
 *    (additional notify party) and SAS METM/Consort itself.
 *
 * Since road and rail became offered modes, the counterparties those modes buy from are
 * offered too — a rail job cannot be sourced from a list with no rail operator on it.
 * They sit after the roadmap block rather than inside it, because the roadmap's §3 table
 * genuinely does not name them.
 *
 * Still dropped: container_yard (reachable as port_terminal), driver (own-fleet master
 * data with its own screen at /admin/drivers, never a counterparty on a payable invoice),
 * and the three air types — air is parked, see TRANSPORT_MODE_LABELS.
 */
export const ROADMAP_VENDOR_TYPES = [
  "buyer",
  "exporter",
  "bank",
  "ocean_carrier",
  "shipping_line",
  "freight_forwarder",
  "port_terminal",
  "customs_agent",
  "destination_agent",
  // Road and rail counterparties.
  "transporter",
  "rail_operator",
  "rail_terminal",
  "other",
];

/** What a user can pick or filter by — the roadmap set only. */
export const VENDOR_TYPE_OPTIONS = ROADMAP_VENDOR_TYPES.map((value) => ({
  value,
  label: VENDOR_TYPE_LABELS[value],
}));

/**
 * The options to show when EDITING a vendor. A row already filed under a dropped type
 * would otherwise open with a Select that matches nothing, and saving would silently
 * rewrite its type — so its current value is appended rather than hidden.
 */
export const vendorTypeOptionsFor = (currentType) =>
  currentType && !ROADMAP_VENDOR_TYPES.includes(currentType)
    ? [...VENDOR_TYPE_OPTIONS, { value: currentType, label: `${VENDOR_TYPE_LABELS[currentType] ?? currentType} (legacy)` }]
    : VENDOR_TYPE_OPTIONS;

// ── Inland transport mode ──

export const INLAND_MODE_LABELS = {
  truck: "By truck",
  rail: "By rail",
};

// ── Own fleet — drivers and vehicles (not vendors: never billed) ──

export const VEHICLE_KIND_LABELS = {
  truck: "Truck",
  dumper: "Dumper",
};

export const VEHICLE_KIND_OPTIONS = Object.entries(VEHICLE_KIND_LABELS).map(([value, label]) => ({ value, label }));

// ── Per-shipment party roles (Export Shipment Workflow roadmap §2/§3/§7) ──────
// Mirrors PARTY_ROLE_LABELS / PARTY_ROLE_VENDOR_TYPES in
// erp-backend/utils/partyRoles.js; keep the two in step.
//
// The roadmap's rule: a party's details are stored once on the party record, the ROLE
// is per shipment. `Vendor.type` is only a default hint — it orders the picker and is
// never a constraint, which is what lets the same company be a Vendor on one job and
// the Freight Forwarder on the next.

export const PARTY_ROLE_LABELS = {
  customer: "Customer",
  manufacturer: "Manufacturer (One-Window Provider)",
  vendor: "Vendor (Goods Supplier)",
  exporter: "Exporter / Shipper (on documents)",
  buyer: "Buyer / Consignee (on documents)",
  notify_party: "Notify Party",
  bank: "Bank (Financial Instrument)",
  ocean_carrier: "Ocean Carrier",
  carrier_agent: "Carrier's Agent",
  freight_forwarder: "Freight Forwarder",
  port_terminal: "Port / Container Terminal",
  clearing_agent: "Customs Clearing Agent",
  destination_agent: "Destination Agent",
  transporter: "Transporter",
  other: "Other",
};

export const PARTY_ROLE_OPTIONS = Object.entries(PARTY_ROLE_LABELS).map(([value, label]) => ({ value, label }));

export const labelForPartyRole = (code) => PARTY_ROLE_LABELS[code] ?? code ?? "—";

/** Which vendor types to list first for a role. A suggestion, never a filter. */
export const PARTY_ROLE_VENDOR_TYPES = {
  customer: ["buyer"],
  manufacturer: ["other", "exporter"],
  vendor: ["exporter", "other"],
  exporter: ["exporter"],
  buyer: ["buyer"],
  notify_party: ["buyer", "other"],
  bank: ["bank"],
  ocean_carrier: ["ocean_carrier", "shipping_line"],
  carrier_agent: ["shipping_line", "destination_agent"],
  freight_forwarder: ["freight_forwarder"],
  port_terminal: ["port_terminal", "container_yard"],
  clearing_agent: ["customs_agent"],
  destination_agent: ["destination_agent"],
  transporter: ["transporter", "rail_operator"],
  other: [],
};

// ── Shipment kind & direction (roadmap §1, Examples 1 & 2) ────────────────────
// How the shipment was born, and which way the goods move. Both are per-shipment:
// Consort is Manufacturer on the Zanitex export and Freight Forwarder on the Chenab
// import, so neither can be inferred from any party record.

export const SHIPMENT_KIND_LABELS = {
  forwarding: "Freight Forwarding",
  trade: "Trade (One-Window)",
};

export const SHIPMENT_DIRECTION_LABELS = {
  export: "Export",
  import: "Import",
};

export const labelForShipmentKind = (code) => SHIPMENT_KIND_LABELS[code] ?? code ?? "—";
export const labelForDirection = (code) => SHIPMENT_DIRECTION_LABELS[code] ?? code ?? "—";
