/**
 * The Phase-1 service catalog (ADR-041, CRM_MASTER §5.6a) — the services a
 * customer selects on a query; they later compose the shipment's OTD path.
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
 * The three service packages a customer actually chooses. These sit ABOVE the service
 * codes above: picking a package presets the service set server-side
 * (erp-backend/utils/servicePackage.js). Customers see packages; internal users see
 * both, and can fine-tune the underlying services.
 */
export const SERVICE_PACKAGE_LABELS = {
  local_transport: "Local Transport",
  loading_point_to_port: "Loading Point → Port",
  international: "International Shipment",
  port_to_consignee: "Port → Consignee (Import Delivery)",
};

export const SERVICE_PACKAGE_DESCRIPTIONS = {
  local_transport:
    "Inland trucking only — we collect from your pickup point and deliver to your delivery point.",
  loading_point_to_port:
    "We move your cargo from your factory or loading point to the port and hand it over at the terminal gate.",
  international:
    "The full export service — CRO, customs clearance, terminal handling, ocean freight, bill of lading and release.",
  port_to_consignee:
    "Your container has landed and been released — we collect it from the terminal, deliver it to the consignee and return the empty.",
};

// Plain-language "what you get", shown on the package cards in the portal.
export const SERVICE_PACKAGE_INCLUDES = {
  local_transport: ["Transporter arranged", "Loading at your site", "Delivery & proof of delivery"],
  loading_point_to_port: [
    "Container release order (CRO)",
    "Empty container pickup & stuffing",
    "Inland transit to the port",
    "Terminal gate-in & handover",
  ],
  international: [
    "Everything in Loading Point → Port",
    "Customs declaration & inspection",
    "Vessel booking & ocean freight",
    "Bill of lading & telex release",
  ],
  port_to_consignee: [
    "Container collected from the terminal",
    "Delivery to the consignee's address",
    "Proof of delivery collected",
    "Empty container returned to the yard",
  ],
};

export const SERVICE_PACKAGE_OPTIONS = Object.entries(SERVICE_PACKAGE_LABELS).map(([value, label]) => ({
  value,
  label,
  description: SERVICE_PACKAGE_DESCRIPTIONS[value],
  includes: SERVICE_PACKAGE_INCLUDES[value],
}));

export const labelForPackage = (code) => SERVICE_PACKAGE_LABELS[code] ?? code ?? "—";

// Who obtains the CRO — the sub-option on Loading Point → Port.
export const CRO_HANDLING_LABELS = {
  not_applicable: "Not applicable",
  customer: "Customer provides the CRO",
  consort: "Consort arranges the CRO",
};

// Shorter forms for table cells and badges.
export const CRO_HANDLING_SHORT = {
  not_applicable: "—",
  customer: "CRO by customer",
  consort: "CRO by Consort",
};

export const labelForCroMode = (code) => CRO_HANDLING_LABELS[code] ?? code ?? "—";

/**
 * Which service codes each package presets. Mirrors PACKAGE_SERVICES in
 * erp-backend/utils/servicePackage.js, which is authoritative — the server always
 * re-resolves, so this copy is only for showing Ops what they're adding on top of.
 */
export const PACKAGE_PRESET_SERVICES = {
  local_transport: ["local_transport"],
  loading_point_to_port: ["local_transport", "port_handling"],
  international: ["local_transport", "port_handling", "customs_clearance", "sea_freight"],
  port_to_consignee: ["local_transport", "port_handling"],
};

// Mirrors erp-backend/utils/servicePackage.js — which packages need port codes.
export const packageUsesPorts = (pkg) => !!pkg && pkg !== "local_transport";
export const packageUsesDestinationPort = (pkg) => pkg === "international";
export const packageHasCroChoice = (pkg) => pkg === "loading_point_to_port";

/**
 * Which door fields a package asks for. Import delivery is the first package to want a
 * port AND a street address — it starts at the terminal named by originPort and ends at
 * the consignee — so "uses ports" no longer implies "no addresses".
 */
export const packageUsesPickupAddress = (pkg) => pkg === "local_transport";
export const packageUsesDeliveryAddress = (pkg) =>
  pkg === "local_transport" || pkg === "port_to_consignee";
/** Free days + empty-return location: the import leg only. */
export const packageUsesImportTerms = (pkg) => pkg === "port_to_consignee";

/**
 * The route line for a query or shipment — which pair of endpoints actually describes
 * the movement. Local transport runs address → address, import delivery runs
 * port → address, and the export packages run port → port (or port → nothing, for a job
 * that ends at the terminal gate).
 *
 * One helper because the "is it local?" ternary was copy-pasted across five call sites,
 * and every one of them printed a blank route the moment a fourth package existed.
 */
export const routeOf = (row) => {
  if (!row) return "";
  const from = packageUsesPickupAddress(row.servicePackage) ? row.pickupAddress : row.originPort;
  const to = packageUsesDeliveryAddress(row.servicePackage) ? row.deliveryAddress : row.destinationPort;
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
  other: "Other",
};

export const VENDOR_TYPE_OPTIONS = Object.entries(VENDOR_TYPE_LABELS).map(([value, label]) => ({ value, label }));
