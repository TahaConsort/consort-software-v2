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
};

export const SERVICE_PACKAGE_DESCRIPTIONS = {
  local_transport:
    "Inland trucking only — we collect from your pickup point and deliver to your delivery point.",
  loading_point_to_port:
    "We move your cargo from your factory or loading point to the port and hand it over at the terminal gate.",
  international:
    "The full export service — CRO, customs clearance, terminal handling, ocean freight, bill of lading and release.",
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
};

// Mirrors erp-backend/utils/servicePackage.js — which packages need port codes.
export const packageUsesPorts = (pkg) => !!pkg && pkg !== "local_transport";
export const packageUsesDestinationPort = (pkg) => pkg === "international";
export const packageHasCroChoice = (pkg) => pkg === "loading_point_to_port";

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

export const INVOICE_STATUS_LABELS = {
  draft: "Draft",
  issued: "Issued",
  part_paid: "Part Paid",
  paid: "Paid",
  void: "Void",
};

// ── Vendors & job-charge ledger (freight-forwarding OTC upgrade) ──

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

export const CHARGE_DIRECTION_LABELS = {
  receivable: "Receivable (money in)",
  payable: "Payable (money out)",
};

export const CHARGE_STATUS_LABELS = {
  estimated: "Estimated",
  confirmed: "Confirmed",
  invoiced: "Invoiced",
  settled: "Settled",
  cancelled: "Cancelled",
};
