/**
 * Service packages — the three offerings the business actually sells, and the one
 * sub-option that varies inside them (who obtains the CRO).
 *
 * A package sits ABOVE the closed `ServiceCode` catalog (ADR-041): choosing one
 * presets `services[]`, so everything already keyed on ServiceCode — charge types,
 * rate cards, load-board postings, `departmentsOnPath`, P&L — keeps working
 * untouched. Ops may still add services on top of the preset.
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

export const SERVICE_PACKAGES = [
  "local_transport",
  "loading_point_to_port",
  "international",
  "port_to_consignee",
];

export const CRO_MODES = ["not_applicable", "customer", "consort"];

export const SERVICE_PACKAGE_LABELS = {
  local_transport: "Local Transport",
  loading_point_to_port: "Loading Point → Port",
  international: "International Shipment",
  port_to_consignee: "Port → Consignee (Import Delivery)",
};

export const SERVICE_PACKAGE_DESCRIPTIONS = {
  local_transport:
    "Inland trucking only — we collect from your pickup point and deliver to your delivery point. No port, no CRO, no customs clearance.",
  loading_point_to_port:
    "We move your cargo from your factory or loading point to the port and hand it over at the terminal gate.",
  international:
    "The full export service — CRO, customs clearance, terminal handling, ocean freight, bill of lading and release.",
  port_to_consignee:
    "Your container has landed and been released — we collect it from the terminal, deliver it to the consignee and return the empty.",
};

export const CRO_HANDLING_LABELS = {
  not_applicable: "Not applicable",
  customer: "Customer provides the CRO",
  consort: "Consort arranges the CRO",
};

export const LC_MODES = ["not_applicable", "customer", "consort"];

export const LC_HANDLING_LABELS = {
  not_applicable: "No LC",
  customer: "Customer provides the LC",
  consort: "Consort manages the LC",
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
  // The import leg buys trucking plus terminal work (LOLO, detention, gate charges).
  // NOT `destination_services` — that code composes the destination AGENT's steps,
  // which is the far end of somebody's export job, not this one.
  port_to_consignee: ["local_transport", "port_handling"],
};

/**
 * Packages with no Container Release Order in play. #1 has no container at all; #4 has
 * one that the shipping line already released to the consignee — the delivery order in
 * the customer's pack is what stands in for it.
 */
const NO_CRO_PACKAGES = ["local_transport", "port_to_consignee"];

/** Which CRO modes a package may hold — mirrors the CHECK in prisma/sql/constraints.sql. */
export const allowedCroModes = (servicePackage) =>
  NO_CRO_PACKAGES.includes(servicePackage) ? ["not_applicable"] : ["customer", "consort"];

/**
 * The CRO mode to assume when the caller did not choose one. Package #2 is the only
 * one where the customer picks; #3 is always ours and #1/#4 have no CRO at all.
 */
export const defaultCroMode = (servicePackage) =>
  NO_CRO_PACKAGES.includes(servicePackage) ? "not_applicable" : "consort";

/**
 * Packages that can trade under a Letter of Credit (ADR-050): the export legs.
 * Unlike the CRO, an LC is genuinely optional on both — open-account exports exist —
 * so `not_applicable` stays selectable there and means "no LC on this trade".
 */
const LC_PACKAGES = ["loading_point_to_port", "international"];

/** Which LC modes a package may hold — mirrors the *_lc_mode_valid CHECKs in prisma/sql/constraints.sql. */
export const allowedLcModes = (servicePackage) =>
  LC_PACKAGES.includes(servicePackage) ? ["not_applicable", "customer", "consort"] : ["not_applicable"];

/**
 * Does this package touch a port (and therefore need a port code)?
 *
 * For #2 and #3 the origin port is where the cargo is GOING; for #4 it is where the
 * container is sitting right now. Either way one UN/LOCODE is required.
 */
export const packageUsesPorts = (servicePackage) => servicePackage !== "local_transport";

/** Does this package need a DESTINATION port? Only the full international path does. */
export const packageUsesDestinationPort = (servicePackage) => servicePackage === "international";

/**
 * Does this package end at a street address rather than a port? Drives which of the
 * free-text door fields the intake demands — #1 runs address→address, #4 runs
 * port→address, and the export packages end at a terminal.
 */
export const packageUsesPickupAddress = (servicePackage) => servicePackage === "local_transport";

export const packageUsesDeliveryAddress = (servicePackage) =>
  servicePackage === "local_transport" || servicePackage === "port_to_consignee";

/** Only the import leg carries free days / an empty-return location. */
export const packageUsesImportTerms = (servicePackage) => servicePackage === "port_to_consignee";

/**
 * Resolve the effective service set: package preset ∪ explicit Ops overrides ∪ the
 * bank-LC rule. The single place services are decided, for both the query intake and
 * the intake-conversion path.
 *
 * Bank-LC customers always imply `lc_finance` — a referral from a bank is by
 * definition an LC-financed shipment (previously duplicated in query.controllers and
 * intake.service).
 */
export const resolveServices = ({ servicePackage, services = [], customerSource, lcHandledBy } = {}) => [
  ...new Set([
    ...(PACKAGE_SERVICES[servicePackage] ?? []),
    ...(services ?? []),
    // Consort managing the LC IS the lc_finance service (ADR-050): its steps
    // (lc_generated, bol_submitted) stay service-gated exactly as before, so consort
    // mode composes them by selling the service rather than via a new gate. A bank-LC
    // referral implies the same — unless the customer explicitly runs their own LC,
    // in which case we only collect the copy (lc_received_from_customer, lcModes-gated)
    // and sell no LC legwork.
    ...(customerSource === "bank_lc" && lcHandledBy !== "customer" ? ["lc_finance"] : []),
    ...(lcHandledBy === "consort" ? ["lc_finance"] : []),
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
 *
 * `port_to_consignee` is deliberately unreachable here: it shares its service set with
 * `loading_point_to_port`, and no row predating packages can be an import leg because
 * the package did not exist when those rows were written.
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

/**
 * Normalise the LC mode (ADR-050), like `resolveCroMode` does for the CRO: coerce a
 * mode the package cannot hold (the *_lc_mode_valid CHECKs) and apply two defaults
 * that keep the column truthful on rows that never chose one:
 *
 *  - a bank-LC customer defaults to `consort` unless they explicitly run their own LC —
 *    a bank referral is by definition an LC-financed trade (RULE-SVC-04);
 *  - a row whose `services` already carry `lc_finance` reads as `consort` — before this
 *    dimension existed, selling `lc_finance` was the only way to say "Consort runs the
 *    LC", and the LC steps still compose off that service gate, so the label follows.
 *
 * Composition does NOT depend on this coercion: lc_generated/bol_submitted remain
 * purely service-gated, so legacy selections reproduce byte-for-byte regardless.
 */
export const resolveLcMode = ({ servicePackage, lcHandledBy, services = [], customerSource } = {}) => {
  const allowed = allowedLcModes(servicePackage);
  let effective = allowed.includes(lcHandledBy) ? lcHandledBy : "not_applicable";
  if (effective === "not_applicable" && allowed.includes("consort")) {
    if (customerSource === "bank_lc") effective = "consort";
    if ((services ?? []).includes("lc_finance")) effective = "consort";
  }
  return effective;
};
