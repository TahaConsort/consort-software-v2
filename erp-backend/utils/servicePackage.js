/**
 * Service packages — the three offerings the business actually sells, and the one
 * sub-option that varies inside them (who obtains the CRO).
 *
 * A package sits ABOVE the closed `ServiceCode` catalog (ADR-041): choosing one
 * presets `services[]`, so everything already keyed on ServiceCode — charge types,
 * rate cards, load-board postings, `resolveCharge`, `departmentsOnPath`, P&L — keeps
 * working untouched. Ops may still add services on top of the preset.
 *
 * THIS IS THE ONLY PLACE the preset and the CRO rules live. `SERVICE_CODES` was
 * already duplicated across eight modules in this repo; do not add a ninth. Import
 * from here.
 */

// The closed Phase-1 service catalog (ADR-041). Canonical JS copy of the Prisma enum.
export const SERVICE_CODES = [
  "local_transport",
  "customs_clearance",
  "sea_freight",
  "port_handling",
  "lc_finance",
  "destination_services",
];

export const SERVICE_PACKAGES = ["local_transport", "loading_point_to_port", "international"];

export const CRO_MODES = ["not_applicable", "customer", "consort"];

export const SERVICE_PACKAGE_LABELS = {
  local_transport: "Local Transport",
  loading_point_to_port: "Loading Point → Port",
  international: "International Shipment",
};

export const SERVICE_PACKAGE_DESCRIPTIONS = {
  local_transport:
    "Inland trucking only — we collect from your pickup point and deliver to your delivery point. No port, no CRO, no customs clearance.",
  loading_point_to_port:
    "We move your cargo from your factory or loading point to the port and hand it over at the terminal gate.",
  international:
    "The full export service — CRO, customs clearance, terminal handling, ocean freight, bill of lading and release.",
};

export const CRO_HANDLING_LABELS = {
  not_applicable: "Not applicable",
  customer: "Customer provides the CRO",
  consort: "Consort arranges the CRO",
};

/**
 * The package→services preset. Ops may add services ON TOP of these, never below —
 * `resolveServices` unions rather than replaces.
 *
 * `international` deliberately omits `destination_services` (destination-agent work is
 * a per-job chargeable add-on, not part of the base package) and `lc_finance` (an
 * add-on, and auto-injected for bank-LC customers below).
 */
export const PACKAGE_SERVICES = {
  local_transport: ["local_transport"],
  loading_point_to_port: ["local_transport", "port_handling"],
  international: ["local_transport", "port_handling", "customs_clearance", "sea_freight"],
};

/** Which CRO modes a package may hold — mirrors the CHECK in prisma/sql/constraints.sql. */
export const allowedCroModes = (servicePackage) =>
  servicePackage === "local_transport" ? ["not_applicable"] : ["customer", "consort"];

/**
 * The CRO mode to assume when the caller did not choose one. Package #2 is the only
 * one where the customer picks; #3 is always ours and #1 has no CRO at all.
 */
export const defaultCroMode = (servicePackage) =>
  servicePackage === "local_transport" ? "not_applicable" : "consort";

/** Does this package move cargo to/through a port (and therefore need port codes)? */
export const packageUsesPorts = (servicePackage) => servicePackage !== "local_transport";

/** Does this package need a DESTINATION port? Only the full international path does. */
export const packageUsesDestinationPort = (servicePackage) => servicePackage === "international";

/**
 * Resolve the effective service set: package preset ∪ explicit Ops overrides ∪ the
 * bank-LC rule. The single place services are decided, for both the query intake and
 * the intake-conversion path.
 *
 * Bank-LC customers always imply `lc_finance` — a referral from a bank is by
 * definition an LC-financed shipment (previously duplicated in query.controllers and
 * intake.service).
 */
export const resolveServices = ({ servicePackage, services = [], customerSource } = {}) => [
  ...new Set([
    ...(PACKAGE_SERVICES[servicePackage] ?? []),
    ...(services ?? []),
    ...(customerSource === "bank_lc" ? ["lc_finance"] : []),
  ]),
];

/**
 * Best-effort package for a row created BEFORE packages existed, inferred from its
 * service set. Used by the backfill (scripts/backfillServicePackages.js) and as the
 * approval-time fallback for a quotation that was sent before this feature shipped.
 *
 * Ordered most-inclusive first: anything touching ocean freight, customs or a
 * destination agent is a full international job; port handling alone stops at the
 * port; everything else is inland trucking.
 */
export const inferPackageFromServices = (services = []) => {
  const has = (s) => services.includes(s);
  if (has("sea_freight") || has("customs_clearance") || has("destination_services")) return "international";
  if (has("port_handling")) return "loading_point_to_port";
  return "local_transport";
};

/**
 * Normalise a package + CRO mode pair into something the DB CHECK will accept:
 * defaults a missing mode, and coerces a mode the package cannot hold.
 */
export const resolveCroMode = ({ servicePackage, croHandledBy } = {}) => {
  const allowed = allowedCroModes(servicePackage);
  return allowed.includes(croHandledBy) ? croHandledBy : defaultCroMode(servicePackage);
};
