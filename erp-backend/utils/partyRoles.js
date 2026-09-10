/**
 * Per-shipment party roles (Export Shipment Workflow roadmap §2/§3/§7).
 *
 * The roadmap's central modelling rule: a company's contact and banking details are
 * stored ONCE on the party record, while the ROLE it plays is captured per shipment.
 * The same company is a Vendor on one job and the Freight Forwarder on the next, and
 * Consort itself is Manufacturer on the Zanitex export and Freight Forwarder on the
 * Chenab import — so the role must never be fixed on the company row.
 *
 * `Vendor.type` is NOT retired. It stays a DEFAULT HINT — what this company usually is —
 * and drives the suggestion list below when ops picks a party for a role. It is never
 * consulted to decide what a party may do on a given shipment.
 *
 * Mirrored by PARTY_ROLE_LABELS in erp-frontend/src/lib/catalog.js; keep the two in step.
 */

export const PARTY_ROLES = [
  "customer",
  "manufacturer",
  "vendor",
  "exporter",
  "buyer",
  "notify_party",
  "bank",
  "ocean_carrier",
  "carrier_agent",
  "freight_forwarder",
  "port_terminal",
  "clearing_agent",
  "destination_agent",
  "transporter",
  "other",
];

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

/**
 * Which `VendorType` rows to offer first when filling a role. A suggestion for the
 * picker, NOT a rule — the whole point of the junction is that any party can hold any
 * role, so the API never rejects a party for having the "wrong" type.
 */
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
  port_terminal: ["port_terminal", "container_yard", "rail_terminal"],
  clearing_agent: ["customs_agent"],
  destination_agent: ["destination_agent"],
  transporter: ["transporter", "rail_operator"],
  other: [],
};

/**
 * The roadmap's Step 1–8 walk-through names a party at every stage. These are the roles
 * an EXPORT trade shipment is expected to carry; the trade-alerts endpoint reports which
 * are still unfilled rather than blocking, because a shipment is assembled over weeks.
 */
export const EXPECTED_EXPORT_ROLES = [
  "customer",
  "manufacturer",
  "vendor",
  "bank",
  "ocean_carrier",
  "freight_forwarder",
  "clearing_agent",
  "port_terminal",
];

/** Bank/tax fields a portal customer must never receive (see RBAC, portal containment). */
export const PARTY_CONFIDENTIAL_FIELDS = [
  "iban",
  "swiftCode",
  "accountTitle",
  "bankName",
  "bankBranch",
  "taxId",
  "strn",
  "paymentTermsDays",
];
