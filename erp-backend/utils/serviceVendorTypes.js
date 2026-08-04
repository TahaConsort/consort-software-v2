/**
 * Which kind of vendor can price which sold service.
 *
 * Consort owns no vessels, trucks or line, so every service on a query is bought
 * from an outside party. This map drives the default vendor filter when ops picks
 * who to ask for rates — it is a suggestion, not a rule: the RFQ dialog lets ops
 * show all vendors, since a generalist filed under `other` may well quote a lane.
 *
 * lc_finance is deliberately empty — that is a bank instrument, not a vendor buy,
 * and the RFQ endpoints reject it outright.
 *
 * Mirrored in erp-frontend/src/lib/catalog.js (SERVICE_VENDOR_TYPES); keep the two
 * in step. Drift only degrades the default filter, never correctness.
 */
export const SERVICE_VENDOR_TYPES = {
  local_transport: ["transporter"],
  sea_freight: ["shipping_line"],
  customs_clearance: ["customs_agent"],
  port_handling: ["port_terminal", "container_yard"],
  destination_services: ["destination_agent"],
  lc_finance: [],
};

// Services that can be sent to vendors for a price.
export const RFQ_SERVICES = Object.keys(SERVICE_VENDOR_TYPES).filter(
  (s) => SERVICE_VENDOR_TYPES[s].length > 0,
);

// The three legs of a rail-mode inland journey. When a query moves inland by rail,
// its local_transport service is asked per leg — three RFQs, three winners — because
// the trucker on the first mile and the rail operator in the middle are different
// vendors with different money.
export const RFQ_LEGS = ["first_mile", "middle_mile", "last_mile"];

// Per-leg default vendor filter — a suggestion, like SERVICE_VENDOR_TYPES.
export const LEG_VENDOR_TYPES = {
  first_mile: ["transporter"],
  middle_mile: ["rail_operator"],
  last_mile: ["transporter"],
};

export const vendorTypesFor = (service, leg) =>
  (leg ? LEG_VENDOR_TYPES[leg] : SERVICE_VENDOR_TYPES[service]) ?? [];
