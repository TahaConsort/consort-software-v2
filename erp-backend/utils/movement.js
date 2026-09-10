import { TransportMode, MovementScope } from "@prisma/client";

/**
 * The two movement axes a query is asked for, and every downstream default reads.
 *
 * They are deliberately SEPARATE questions. Mode is how the goods travel; scope is how
 * far they go. A rail move can be domestic or an export, and trucking to Kabul is road
 * but not domestic — collapsing the two would make either of those unexpressible.
 *
 * One home for the value lists, the same reasoning as utils/serviceCodes.js: Zod, the
 * seed and the frontend catalog all need them, and a second hand-written copy is a
 * copy that drifts.
 */
export const TRANSPORT_MODES = Object.values(TransportMode);

/**
 * The modes actually on sale. TransportMode still carries air and the value stays in
 * the database, but Consort does not sell air freight for now, so the API refuses it
 * and the query form does not offer it. Re-enabling is this list plus
 * TRANSPORT_MODE_LABELS in the frontend catalog: no migration, no rows to backfill.
 */
export const OFFERED_MODES = TRANSPORT_MODES.filter((m) => m !== "air");
export const MOVEMENT_SCOPES = Object.values(MovementScope);

/**
 * The services each mode normally sells, used to shortlist the service checkboxes on the
 * query form. A SUGGESTION, never a rule: the form still lets anything be ticked, and the
 * API takes free text, because a real job regularly needs something off its mode's list.
 *
 * Mirrored by SERVICES_BY_MODE in erp-frontend/src/lib/catalog.js; keep the two in step.
 */
export const SERVICES_BY_MODE = {
  sea: ["sea_freight", "port_handling", "customs_clearance", "local_transport", "lc_finance", "destination_services"],
  rail: ["rail_freight", "local_transport", "customs_clearance"],
  road: ["local_transport", "customs_clearance"],
};

/**
 * The vendor types worth shortlisting for each mode when sourcing a rate. Same status as
 * SERVICES_BY_MODE: a shortlist for the picker, not a constraint the API enforces.
 */
export const VENDOR_TYPES_BY_MODE = {
  sea: ["shipping_line", "ocean_carrier", "freight_forwarder", "port_terminal", "container_yard", "customs_agent", "destination_agent"],
  rail: ["rail_operator", "rail_terminal", "transporter", "customs_agent"],
  road: ["transporter", "customs_agent"],
};
