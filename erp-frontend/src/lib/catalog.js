/**
 * The Phase-1 service catalog (ADR-041, CRM_MASTER §5.6a). A query's `services` is free
 * text now, so this is the SUGGESTED list the pickers offer — not a closed set. Anything
 * not in it renders as the raw string.
 */
export const SERVICE_LABELS = {
  local_transport: "Local Transport / Inland",
  customs_clearance: "Customs Clearance",
  sea_freight: "Sea Freight (Ocean)",
  port_handling: "Port Handling / Terminal",
  lc_finance: "LC / Trade Finance",
  destination_services: "Destination Services / Agent",
};

export const SERVICE_OPTIONS = Object.entries(SERVICE_LABELS).map(([value, label]) => ({ value, label }));

export const labelForService = (code) => SERVICE_LABELS[code] ?? code;

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

// How the BDO gave a sent quote to the customer (Quotation.sharedVia).
export const QUOTE_SHARE_CHANNEL_LABELS = {
  email: "Email",
  phone: "Phone",
  whatsapp: "WhatsApp",
  in_person: "In person",
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

export const VENDOR_TYPE_LABELS = {
  transporter: "Transporter",
  shipping_line: "Shipping Line",
  container_yard: "Container Yard",
  customs_agent: "Customs Agent",
  destination_agent: "Destination Agent",
  port_terminal: "Port Terminal",
  rail_operator: "Rail Operator",
  freight_forwarder: "Freight Forwarder",
  ocean_carrier: "Ocean Carrier",
  exporter: "Exporter",
  buyer: "Buyer",
  bank: "Bank",
  driver: "Driver",
  other: "Other",
};

export const VENDOR_TYPE_OPTIONS = Object.entries(VENDOR_TYPE_LABELS).map(([value, label]) => ({ value, label }));

// ── Vendor rate requests (RFQ) — the buy side of a query ──

export const RFQ_STATUS_LABELS = {
  open: "Awaiting rates",
  awarded: "Awarded",
  cancelled: "Cancelled",
};

export const RFQ_STATUS_OPTIONS = Object.entries(RFQ_STATUS_LABELS).map(([value, label]) => ({ value, label }));

export const VENDOR_QUOTE_STATUS_LABELS = {
  pending: "Awaiting reply",
  quoted: "Quoted",
  declined: "Declined",
};

/**
 * Which kind of vendor can price which sold service — the default filter when ops
 * picks who to ask for rates. A suggestion, not a rule: the request dialog can show
 * all vendors, since a generalist filed under `other` may still quote a lane.
 *
 * Mirrors SERVICE_VENDOR_TYPES in erp-backend/utils/serviceVendorTypes.js; keep the
 * two in step. lc_finance is absent on purpose — a bank instrument is not a vendor buy.
 */
export const SERVICE_VENDOR_TYPES = {
  local_transport: ["transporter"],
  sea_freight: ["shipping_line"],
  customs_clearance: ["customs_agent"],
  port_handling: ["port_terminal", "container_yard"],
  destination_services: ["destination_agent"],
  lc_finance: [],
};

/** Services that can actually be sent to a vendor for a price. */
export const RFQ_SERVICES = Object.keys(SERVICE_VENDOR_TYPES).filter(
  (s) => SERVICE_VENDOR_TYPES[s].length > 0,
);

// ── Inland transport mode + rail legs ──

export const INLAND_MODE_LABELS = {
  truck: "By truck",
  rail: "By rail",
};

/**
 * A rail-mode inland journey is priced per leg — three rate requests, three winners.
 * Mirrors RFQ_LEGS / LEG_VENDOR_TYPES in erp-backend/utils/serviceVendorTypes.js;
 * keep the two in step.
 */
export const RFQ_LEG_LABELS = {
  first_mile: "First mile (truck)",
  middle_mile: "Rail — terminal to terminal",
  last_mile: "Last mile (truck)",
};

export const RFQ_LEGS = Object.keys(RFQ_LEG_LABELS);

export const LEG_VENDOR_TYPES = {
  first_mile: ["transporter"],
  middle_mile: ["rail_operator"],
  last_mile: ["transporter"],
};

export const vendorTypesFor = (service, leg) =>
  (leg ? LEG_VENDOR_TYPES[leg] : SERVICE_VENDOR_TYPES[service]) ?? [];

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

// ── Export trade documents (roadmap §4/§7.1) ──────────────────────────────────
// The roadmap workflow states. DERIVED server-side from which documents exist, so the
// UI only ever renders them — there is no control anywhere that sets a stage.

export const TRADE_STAGE_LABELS = {
  none: "Not a trade shipment",
  contract_registered: "Contract Registered",
  fi_active: "Financial Instrument Active",
  packing_list_confirmed: "Packing List Confirmed",
  commercial_invoice_raised: "Commercial Invoice Raised",
  booking_confirmed: "Booking Confirmed / GD Filed",
  shipped_on_board: "Shipped on Board (B/L Issued)",
  logistics_settled: "Logistics Invoices Settled",
  payment_realised: "Payment Realised (CAD/DA)",
  fi_closed: "Financial Instrument Closed",
};

/** Rendering order for the progress bar — `none` is deliberately not a rung. */
export const TRADE_STAGE_ORDER = [
  "contract_registered",
  "fi_active",
  "packing_list_confirmed",
  "commercial_invoice_raised",
  "booking_confirmed",
  "shipped_on_board",
  "logistics_settled",
  "payment_realised",
  "fi_closed",
];

export const labelForTradeStage = (code) => TRADE_STAGE_LABELS[code] ?? code ?? "—";

export const FI_TYPE_LABELS = {
  exp_form: "Bank EXP Registration",
  lc: "Letter of Credit",
  dp: "Documents against Payment (DP)",
  da: "Documents against Acceptance (DA)",
  advance: "Advance Payment",
  open_account: "Open Account",
};

export const FI_STATUS_LABELS = {
  draft: "Draft",
  active: "Active",
  expired: "Expired",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const FI_STATUS_CLASS = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300",
  expired: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300",
  closed: "bg-muted text-muted-foreground border-muted-foreground/30",
  draft: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300",
  cancelled: "bg-muted text-muted-foreground border-muted-foreground/30 line-through",
};

export const TRADE_INVOICE_SIDE_LABELS = {
  purchase: "Purchase — vendor bills Consort",
  sale: "Sale — Consort bills the customer",
};

export const TRADE_CONTRACT_STATUS_LABELS = {
  draft: "Draft",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const FREIGHT_TERMS_LABELS = { prepaid: "Freight Prepaid", collect: "Freight Collect" };
