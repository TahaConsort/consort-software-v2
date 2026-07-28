/**
 * prisma/seed.js — idempotent seed (DATABASE.md §8).
 *
 * Minimal, deterministic seed. Clears the DB first, then seeds ONLY the data the
 * app needs to run — never hard-coding the service→step mapping twice (ADR-001):
 *   1. Departments — the 7 canonical codes.
 *   2. otd_step_templates — the 14 canonical rows; the composition logic reads
 *      these at quote approval (RULE-SVC-01, ADR-040).
 *   3. task_templates — one per composable step; the Action Engine instantiates
 *      the next step's task from these (RULE-AE-02).
 *   4. Reference data — ports (UN/LOCODE subset), container types.
 *   5. Bootstrap accounts — one ACTIVE login per role, all reporting to the CEO,
 *      plus department heads for the assignment chain (RULE-AE-03).
 *
 * Run manually:  node prisma/seed.js     (or: npx prisma db seed)
 */
import bcrypt from "bcrypt";
import { pathToFileURL } from "url";
import prisma from "../config/prisma.js";

const DEPARTMENTS = [
  { code: "management", name: "Management" },
  { code: "sales", name: "Sales" },
  { code: "operations", name: "Operations" },
  { code: "compliance", name: "Compliance" },
  { code: "finance", name: "Finance" },
  { code: "hr", name: "HR" },
  { code: "transport", name: "Transport" },
];

// The DB form of WORKFLOW §4a.1 / DATABASE §8 — the composition source of truth
// (ADR-001/040). utils/composition.js reads this table and never re-encodes the mapping.
//
// GATES, evaluated package → CRO mode → service, each EMPTY-MEANS-DON'T-GATE:
//   packages  restrict to those service packages ("always: true" + packages reads
//             "always, on these packages"). A shipment with servicePackage = null was
//             composed before packages existed and skips this gate entirely.
//   croModes  select exactly one of the two mutually exclusive CRO rows (50 vs 55).
//   services  the original ADR-040 rule.
//
// Canonical numbers are stable reporting keys and are RE-SPACED to multiples of 10 so
// future steps can be inserted without renumbering. This is safe because every
// canonical-number comparison in the codebase is intra-shipment, and every
// cross-shipment lookup is by stepCode. The permitted out-of-order pair
// (lc_generated / vessel_booked, RULE-SH-03) is keyed on stepCode in
// utils/composition.js — OUT_OF_ORDER_PAIRS — precisely so this re-spacing is safe.
//
// `dueOffsetHours` seeds each step's TaskTemplate SLA; the trucking leg is hours, not days.
const LOCAL = "local_transport";
const LP_PORT = "loading_point_to_port";
const INTL = "international";
const ALL_PORT_PACKAGES = [LP_PORT, INTL];

const OTD_STEP_TEMPLATES = [
  // ── Every package ──────────────────────────────────────────────────────────────
  { canonicalNo: 10, stepCode: "order_lock", title: "Order Lock",
    ownerDepartment: "operations", always: true, packages: [], croModes: [], services: [],
    requiredDocTypes: [], dueOffsetHours: 24, derivedStatus: "order_confirmed" },

  // ── Trade-doc pack: port-bound packages only. A local trucking job needs no
  //    commercial invoice / packing list / authority letterhead.
  //
  //    ONE step, a package-dependent checklist (ADR-048). `requiredDocTypes` is empty
  //    because the pack now lives in OTD_STEP_ACTION_TEMPLATES, where it can differ per
  //    package — international collects a seven-document pack, loading-point-to-port the
  //    original three. missingRequiredDocs unions both sources, so RULE-SH-06 is unchanged.
  { canonicalNo: 20, stepCode: "order_confirmed", title: "Customer Doc Pack & Order Confirmation",
    ownerDepartment: "operations", always: true, packages: ALL_PORT_PACKAGES, croModes: [], services: [],
    requiredDocTypes: [],
    dueOffsetHours: 48, derivedStatus: "order_confirmed" },

  // ── Package #1: the pure-local trucking leg. No container, no port, no trade docs.
  //    Transport-owned end to end so the job never 403s across a department handoff.
  { canonicalNo: 22, stepCode: "transporter_assigned", title: "Transporter Assigned & Rate Agreed",
    ownerDepartment: "transport", always: true, packages: [LOCAL], croModes: [], services: [],
    requiredDocTypes: [], dueOffsetHours: 8, derivedStatus: "transporter_assigned" },
  { canonicalNo: 24, stepCode: "vehicle_dispatched", title: "Vehicle Dispatched to Loading Point",
    ownerDepartment: "transport", always: true, packages: [LOCAL], croModes: [], services: [],
    requiredDocTypes: [], dueOffsetHours: 12, derivedStatus: "vehicle_dispatched" },
  { canonicalNo: 26, stepCode: "goods_loaded", title: "Goods Loaded at Pickup Point",
    ownerDepartment: "transport", always: true, packages: [LOCAL], croModes: [], services: [],
    requiredDocTypes: ["proof"], dueOffsetHours: 12, derivedStatus: "goods_loaded" },
  { canonicalNo: 28, stepCode: "in_transit", title: "In Transit to Delivery Point",
    ownerDepartment: "transport", always: true, packages: [LOCAL], croModes: [], services: [],
    requiredDocTypes: [], dueOffsetHours: 24, derivedStatus: "in_transit" },

  // ── Trade finance / vessel booking (the permitted out-of-order pair) ───────────
  { canonicalNo: 30, stepCode: "lc_generated", title: "SWIFT / LC Advice",
    ownerDepartment: "compliance", always: false, packages: [], croModes: [], services: ["lc_finance"],
    requiredDocTypes: ["lc"], dueOffsetHours: 48, derivedStatus: "lc_generated" },
  { canonicalNo: 40, stepCode: "vessel_booked", title: "Vessel Slot Booking (Shipping Line)",
    ownerDepartment: "operations", always: false, packages: [], croModes: [], services: ["sea_freight"],
    requiredDocTypes: [], dueOffsetHours: 48, derivedStatus: "vessel_booked" },

  // ── CRO: two mutually exclusive rows selected by croHandledBy ─────────────────
  { canonicalNo: 50, stepCode: "cro_received_from_customer", title: "CRO Received from Customer",
    ownerDepartment: "operations", always: true, packages: ALL_PORT_PACKAGES, croModes: ["customer"], services: [],
    requiredDocTypes: ["cro"], dueOffsetHours: 48, derivedStatus: "cro_released" },
  { canonicalNo: 55, stepCode: "cro_released", title: "Apply & Obtain CRO from Line",
    ownerDepartment: "operations", always: true, packages: ALL_PORT_PACKAGES, croModes: ["consort"], services: [],
    requiredDocTypes: ["commercial_invoice", "packing_list", "authority_letterhead", "cro"],
    dueOffsetHours: 48, derivedStatus: "cro_released" },

  // ── Container + inland leg: port-bound packages that bought local transport ───
  { canonicalNo: 60, stepCode: "empty_container_pickup", title: "Empty Container Pickup — LOLO (Yard)",
    ownerDepartment: "transport", always: false, packages: ALL_PORT_PACKAGES, croModes: [], services: [LOCAL],
    requiredDocTypes: ["eir_out"], dueOffsetHours: 24, derivedStatus: "empty_container_pickup" },
  { canonicalNo: 70, stepCode: "cargo_pickup", title: "Cargo Pickup & Stuffing (Shipper Seal)",
    ownerDepartment: "transport", always: false, packages: ALL_PORT_PACKAGES, croModes: [], services: [LOCAL],
    requiredDocTypes: [], dueOffsetHours: 24, derivedStatus: "cargo_pickup" },
  { canonicalNo: 80, stepCode: "inland_transit", title: "Inland Transit (Origin → Port)",
    ownerDepartment: "transport", always: false, packages: ALL_PORT_PACKAGES, croModes: [], services: [LOCAL],
    requiredDocTypes: [], dueOffsetHours: 24, derivedStatus: "inland_transit" },

  // ── Customs ───────────────────────────────────────────────────────────────────
  // ONE customs step (ADR-048): filing, duty, examination and seal are sub-actions of
  // a single milestone rather than two steps that could only ever complete in lockstep.
  // Its two predecessors stay as `active: false` rows — never composed again, but still
  // resolvable by stepCode for shipments that already ran them.
  { canonicalNo: 95, stepCode: "customs_clearance", title: "Customs Clearance",
    ownerDepartment: "compliance", always: false, packages: [], croModes: [], services: ["customs_clearance"],
    requiredDocTypes: [], dueOffsetHours: 72, derivedStatus: "inspected_sealed" },
  { canonicalNo: 90, stepCode: "customs_entry", title: "Customs Declaration (GD Filing)",
    ownerDepartment: "compliance", always: false, packages: [], croModes: [], services: ["customs_clearance"],
    requiredDocTypes: ["gd"], dueOffsetHours: 48, derivedStatus: "customs_entry", active: false },
  { canonicalNo: 100, stepCode: "inspected_sealed", title: "Customs Inspection & Seal",
    ownerDepartment: "compliance", always: false, packages: [], croModes: [], services: ["customs_clearance"],
    requiredDocTypes: ["inspection_cert"], dueOffsetHours: 48, derivedStatus: "inspected_sealed", active: false },

  // ── Terminal + ocean ──────────────────────────────────────────────────────────
  { canonicalNo: 110, stepCode: "port_handover", title: "Port Gate-In / Terminal Handover (EIR)",
    ownerDepartment: "operations", always: false, packages: [], croModes: [], services: ["port_handling", "sea_freight"],
    requiredDocTypes: ["eir_in"], dueOffsetHours: 24, derivedStatus: "port_handover" },
  { canonicalNo: 120, stepCode: "bol_issued", title: "Bill of Lading Issuance",
    ownerDepartment: "operations", always: false, packages: [], croModes: [], services: ["sea_freight"],
    requiredDocTypes: ["bol"], dueOffsetHours: 48, derivedStatus: "bol_issued" },
  { canonicalNo: 130, stepCode: "bol_submitted", title: "Document Submission to Bank",
    ownerDepartment: "finance", always: false, packages: [], croModes: [], services: ["lc_finance"],
    requiredDocTypes: ["bank_receipt"], dueOffsetHours: 48, derivedStatus: "bol_submitted" },
  { canonicalNo: 140, stepCode: "telex_released", title: "Telex Release / BL Surrender",
    ownerDepartment: "finance", always: false, packages: [], croModes: [], services: ["sea_freight"],
    requiredDocTypes: ["telex"], dueOffsetHours: 48, derivedStatus: "telex_released" },

  // ── Destination agent (add-on: Ops adds `destination_services`) ───────────────
  { canonicalNo: 150, stepCode: "destination_do", title: "Delivery Order & Gate Pass (Dest. Agent)",
    ownerDepartment: "operations", always: false, packages: [], croModes: [], services: ["destination_services"],
    requiredDocTypes: ["delivery_order", "gate_pass"], dueOffsetHours: 48, derivedStatus: "destination_do" },
  { canonicalNo: 160, stepCode: "destination_pickup", title: "Destination Container Pickup (EIR)",
    ownerDepartment: "operations", always: false, packages: [], croModes: [], services: ["destination_services"],
    requiredDocTypes: ["eir_pickup"], dueOffsetHours: 48, derivedStatus: "destination_pickup" },

  // ── Terminal steps, one per package. Each derives `delivered`, which is what
  //    maybeSettleTx (otc.service.js) requires before a shipment can settle — so a
  //    package that never composes `delivered` still needs one of these.
  { canonicalNo: 170, stepCode: "delivered", title: "Final Delivery / POD",
    ownerDepartment: "operations", always: true, packages: [INTL], croModes: [], services: [],
    requiredDocTypes: ["pod"], dueOffsetHours: 48, derivedStatus: "delivered" },
  { canonicalNo: 172, stepCode: "local_delivered", title: "Delivered & POD Collected",
    ownerDepartment: "transport", always: true, packages: [LOCAL], croModes: [], services: [],
    requiredDocTypes: ["pod"], dueOffsetHours: 24, derivedStatus: "delivered" },
  { canonicalNo: 175, stepCode: "port_job_completed", title: "Port Handover Confirmed / Job Complete",
    ownerDepartment: "operations", always: true, packages: [LP_PORT], croModes: [], services: [],
    requiredDocTypes: [], dueOffsetHours: 24, derivedStatus: "delivered" },

  { canonicalNo: 180, stepCode: "empty_return", title: "Empty Container Return (EIR)",
    ownerDepartment: "operations", always: false, packages: [], croModes: [], services: ["destination_services"],
    requiredDocTypes: ["eir_empty_return"], dueOffsetHours: 48, derivedStatus: "delivered" },
];

// ── Sub-action catalog (ADR-048) ──────────────────────────────────────────────
// The checklist that hangs under a main step. Gated exactly like the step catalog
// (package → CRO mode → service, each empty-means-don't-gate), which is what lets ONE
// `order_confirmed` step carry two different document packs.
//
// `kind: "document"` items are DERIVED — satisfied by a live document of that type on
// the shipment (same rule as RULE-SH-06), never ticked by hand. `kind: "manual"` items
// are ticked by a member of the step's owning department.
const OTD_STEP_ACTION_TEMPLATES = [
  // Order confirmation — INTERNATIONAL. The full export document pack the customer
  // must hand over before the order is confirmed.
  { stepCode: "order_confirmed", actionCode: "packing_list",         title: "Packing List",           kind: "document", docType: "packing_list",          sortOrder: 10, required: true, packages: [INTL],    croModes: [], services: [] },
  { stepCode: "order_confirmed", actionCode: "gd",                   title: "GD / Customs Declaration", kind: "document", docType: "gd",                  sortOrder: 20, required: true, packages: [INTL],    croModes: [], services: [] },
  // Auto-satisfied: the approved quotation is rendered to PDF and attached to the
  // shipment at approval (shipment.service.js), so this item is already ticked.
  { stepCode: "order_confirmed", actionCode: "quotation",            title: "Quotation (auto-attached)", kind: "document", docType: "quotation",          sortOrder: 30, required: true, packages: [INTL],    croModes: [], services: [] },
  { stepCode: "order_confirmed", actionCode: "undertaking",          title: "Undertaking",            kind: "document", docType: "undertaking",           sortOrder: 40, required: true, packages: [INTL],    croModes: [], services: [] },
  { stepCode: "order_confirmed", actionCode: "sales_tax_invoice",    title: "Sales Tax Invoice",      kind: "document", docType: "sales_tax_invoice",     sortOrder: 50, required: true, packages: [INTL],    croModes: [], services: [] },
  { stepCode: "order_confirmed", actionCode: "commercial_invoice",   title: "Commercial Invoice",     kind: "document", docType: "commercial_invoice",    sortOrder: 60, required: true, packages: [INTL],    croModes: [], services: [] },
  { stepCode: "order_confirmed", actionCode: "certificate_of_origin", title: "Certificate of Origin", kind: "document", docType: "certificate_of_origin", sortOrder: 70, required: true, packages: [INTL],    croModes: [], services: [] },

  // Order confirmation — LOADING POINT → PORT. The job stops at the terminal gate, so
  // it needs the shipping pack, not the full export/trade pack.
  { stepCode: "order_confirmed", actionCode: "lp_packing_list",       title: "Packing List",          kind: "document", docType: "packing_list",          sortOrder: 10, required: true, packages: [LP_PORT], croModes: [], services: [] },
  { stepCode: "order_confirmed", actionCode: "lp_commercial_invoice", title: "Commercial Invoice",    kind: "document", docType: "commercial_invoice",    sortOrder: 20, required: true, packages: [LP_PORT], croModes: [], services: [] },
  { stepCode: "order_confirmed", actionCode: "lp_authority_letter",   title: "Authority Letterhead",  kind: "document", docType: "authority_letterhead",  sortOrder: 30, required: true, packages: [LP_PORT], croModes: [], services: [] },

  // Customs clearance — the merged step's working checklist.
  { stepCode: "customs_clearance", actionCode: "gd_filed",         title: "GD filed in WeBOC / PSW",        kind: "manual",   docType: null,               sortOrder: 10, required: true, packages: [], croModes: [], services: [] },
  { stepCode: "customs_clearance", actionCode: "duty_paid",        title: "Duty & taxes paid",              kind: "manual",   docType: null,               sortOrder: 20, required: true, packages: [], croModes: [], services: [] },
  { stepCode: "customs_clearance", actionCode: "gd_doc",           title: "GD document attached",           kind: "document", docType: "gd",               sortOrder: 30, required: true, packages: [], croModes: [], services: [] },
  { stepCode: "customs_clearance", actionCode: "exam_scheduled",   title: "Examination scheduled",          kind: "manual",   docType: null,               sortOrder: 40, required: true, packages: [], croModes: [], services: [] },
  { stepCode: "customs_clearance", actionCode: "cargo_examined",   title: "Cargo examined & seal applied",  kind: "manual",   docType: null,               sortOrder: 50, required: true, packages: [], croModes: [], services: [] },
  { stepCode: "customs_clearance", actionCode: "inspection_cert",  title: "Inspection certificate attached", kind: "document", docType: "inspection_cert", sortOrder: 60, required: true, packages: [], croModes: [], services: [] },
];

// Admin-extensible charge catalog. `defaultDirection`/`defaultStepCode`/`service` are hints
// used when seeding charges at approval and when adding ad-hoc charges.
const CHARGE_TYPES = [
  { code: "ocean_freight",          label: "Ocean Freight",              defaultDirection: "payable",    defaultStepCode: "vessel_booked",          service: "sea_freight" },
  { code: "lolo",                   label: "LOLO (Lift-On/Lift-Off)",    defaultDirection: "payable",    defaultStepCode: "empty_container_pickup", service: "local_transport" },
  { code: "inland_transport",       label: "Inland Transport / Trucking", defaultDirection: "payable",   defaultStepCode: "inland_transit",         service: "local_transport" },
  { code: "fuel_surcharge",         label: "Fuel Surcharge",             defaultDirection: "payable",    defaultStepCode: "in_transit",             service: "local_transport" },
  { code: "loading_labour",         label: "Loading / Unloading Labour", defaultDirection: "payable",    defaultStepCode: "goods_loaded",           service: "local_transport" },
  { code: "cro_charges",            label: "CRO / Container Release Charges", defaultDirection: "payable", defaultStepCode: "cro_released",        service: "port_handling" },
  { code: "customs_clearance",      label: "Customs Clearance / Agent Fee", defaultDirection: "payable", defaultStepCode: "customs_clearance",     service: "customs_clearance" },
  { code: "port_handling",          label: "Port Handling / THC",        defaultDirection: "payable",    defaultStepCode: "port_handover",          service: "port_handling" },
  { code: "documentation_fee",      label: "Documentation / BL Fee",     defaultDirection: "receivable", defaultStepCode: "bol_issued",             service: "sea_freight" },
  { code: "do_fee",                 label: "Delivery Order Fee",         defaultDirection: "payable",    defaultStepCode: "destination_do",         service: "destination_services" },
  { code: "agency_fee",             label: "Destination Agency Fee",     defaultDirection: "payable",    defaultStepCode: "destination_do",         service: "destination_services" },
  { code: "detention_demurrage",    label: "Detention / Demurrage",      defaultDirection: "payable",    defaultStepCode: null,                     service: null },
  { code: "lc_charges",             label: "LC / Bank Charges",          defaultDirection: "payable",    defaultStepCode: "bol_submitted",          service: "lc_finance" },
  { code: "freight_forwarding_fee", label: "Freight Forwarding Service Fee", defaultDirection: "receivable", defaultStepCode: null,                 service: null },
  { code: "other",                  label: "Other",                      defaultDirection: null,         defaultStepCode: null,                     service: null },
];

// Demo vendors (staging). Reference numbers manually numbered; the runtime allocator
// is kept in step below.
const VENDORS = [
  { name: "Karachi Container Yard Ltd",  type: "container_yard",   city: "Karachi", country: "PK", paymentTermsDays: 7,  currency: "PKR" },
  { name: "National Highway Transporters", type: "transporter",    city: "Lahore",  country: "PK", paymentTermsDays: 15, currency: "PKR" },
  { name: "Blue Ocean Shipping Line",    type: "shipping_line",    city: "Karachi", country: "PK", paymentTermsDays: 30, currency: "USD" },
  { name: "Clearwell Customs Agents",    type: "customs_agent",    city: "Karachi", country: "PK", paymentTermsDays: 15, currency: "PKR" },
  { name: "Jebel Ali Destination Agency", type: "destination_agent", city: "Dubai", country: "AE", paymentTermsDays: 30, currency: "USD" },
];

const PORTS = [
  { code: "PKKHI", name: "Karachi", country: "PK" },
  { code: "PKQCT", name: "Port Qasim", country: "PK" },
  { code: "AEJEA", name: "Jebel Ali", country: "AE" },
  { code: "CNSHA", name: "Shanghai", country: "CN" },
  { code: "SGSIN", name: "Singapore", country: "SG" },
  { code: "USNYC", name: "New York", country: "US" },
  { code: "GBFXT", name: "Felixstowe", country: "GB" },
  { code: "NLRTM", name: "Rotterdam", country: "NL" },
];

const CONTAINER_TYPES = [
  { code: "20GP", label: "20ft General Purpose" },
  { code: "40GP", label: "40ft General Purpose" },
  { code: "40HC", label: "40ft High Cube" },
  { code: "REEFER20", label: "20ft Reefer" },
  { code: "REEFER40", label: "40ft Reefer" },
];

// Rate cards powering the public rate calculator (CRM_MASTER §5.20). Generic
// service-only rows are the fallback; lane-specific rows override them.
const RATE_CARDS = [
  { service: "local_transport",  baseAmount: 350,  perKgAmount: 0.02, minAmount: 250 },
  { service: "customs_clearance", baseAmount: 200,  minAmount: 150 },
  { service: "sea_freight",      baseAmount: 1200, perKgAmount: 0.01, minAmount: 900 },
  { service: "port_handling",    baseAmount: 300,  minAmount: 200 },
  { service: "lc_finance",       baseAmount: 450,  minAmount: 300 },
  { service: "destination_services", baseAmount: 400, minAmount: 300 },
  // Lane-specific sea freight overrides
  { service: "sea_freight", originPort: "PKKHI", destinationPort: "AEJEA", baseAmount: 950 },
  { service: "sea_freight", originPort: "PKKHI", destinationPort: "CNSHA", baseAmount: 1450 },
  { service: "sea_freight", originPort: "PKKHI", destinationPort: "NLRTM", baseAmount: 2200 },
  { service: "sea_freight", originPort: "AEJEA", destinationPort: "USNYC", baseAmount: 2100 },
];

const DAY = 24 * 60 * 60 * 1000;
// Load board postings shown on the public storefront (CRM_MASTER §5.20).
const LOAD_BOARD_POSTINGS = [
  { mode: "sea",  originPort: "PKKHI", destinationPort: "AEJEA", containerTypeCode: "40HC", equipment: "40HC x4", capacity: 4, transitDays: 5,  indicativeRate: 950,  departureInDays: 3,  services: ["sea_freight", "port_handling"] },
  { mode: "sea",  originPort: "PKKHI", destinationPort: "CNSHA", containerTypeCode: "20GP", equipment: "20GP x6", capacity: 6, transitDays: 18, indicativeRate: 1450, departureInDays: 6,  services: ["sea_freight", "customs_clearance", "port_handling"] },
  { mode: "road", originPort: "PKKHI", destinationPort: "PKQCT", equipment: "Flatbed x2",   capacity: 2, transitDays: 1,  indicativeRate: 300,  departureInDays: 1,  services: ["local_transport"] },
  { mode: "sea",  originPort: "PKKHI", destinationPort: "NLRTM", containerTypeCode: "REEFER40", equipment: "Reefer 40 x2", capacity: 2, transitDays: 24, indicativeRate: 2600, departureInDays: 9, services: ["sea_freight", "customs_clearance", "port_handling", "lc_finance"] },
  { mode: "sea",  originPort: "AEJEA", destinationPort: "USNYC", containerTypeCode: "40GP", equipment: "40GP x3", capacity: 3, transitDays: 22, indicativeRate: 2100, departureInDays: 5,  services: ["sea_freight", "port_handling"] },
];

// ── Bootstrap accounts (staging) ───────────────────────────────────────────────
// One ACTIVE login per role (INV-01: each internal user has an Employee in one
// department). Temporary @consort.test emails; shared password for staging only.
const SEED_PASSWORD = "1234567";

const ACCOUNTS = [
  { role: "ceo",                first: "Casey",   last: "Chief",      dept: "management", email: "ceo@consort.test" },
  { role: "project_director",   first: "Parker",  last: "Director",   dept: "management", email: "project.director@consort.test" },
  { role: "director",           first: "Devon",   last: "Director",   dept: "management", email: "director@consort.test" },
  { role: "cfo",                first: "Quinn",   last: "Finance",    dept: "management", email: "cfo@consort.test" },
  { role: "gm",                 first: "Morgan",  last: "Manager",    dept: "management", email: "gm@consort.test" },
  { role: "hr",                 first: "Harper",  last: "People",     dept: "hr",         email: "hr@consort.test" },
  { role: "asm",                first: "Alex",    last: "Sales",      dept: "sales",      email: "asm@consort.test" },
  { role: "bdo",                first: "Bailey",  last: "Dev",        dept: "sales",      email: "bdo@consort.test" },
  { role: "ops_manager",        first: "Omar",    last: "Ops",        dept: "operations", email: "ops.manager@consort.test" },
  { role: "ops_exec",          first: "Olive",   last: "Ops",        dept: "operations", email: "ops.exec@consort.test" },
  { role: "compliance_manager", first: "Cameron", last: "Compliance", dept: "compliance", email: "compliance.manager@consort.test" },
  { role: "compliance_exec",    first: "Riley",   last: "Compliance", dept: "compliance", email: "compliance.exec@consort.test" },
  { role: "transport_manager",  first: "Taylor",  last: "Transport",  dept: "transport",  email: "transport.manager@consort.test" },
  { role: "transport_exec",     first: "Devon",   last: "Transport",  dept: "transport",  email: "transport.exec@consort.test" },
  { role: "accounts",           first: "Aubrey",  last: "Accounts",   dept: "finance",    email: "accounts@consort.test" },
];

// Department head = the role that owns the assignment chain (RULE-AE-03). CFO
// heads Finance while sitting in the Management tier (ADR-044).
const DEPT_HEADS = {
  management: "ceo@consort.test",
  sales: "asm@consort.test",
  operations: "ops.manager@consort.test",
  compliance: "compliance.manager@consort.test",
  transport: "transport.manager@consort.test",
  finance: "cfo@consort.test",
  hr: "hr@consort.test",
};

// ── Wipe all business + account data (departments/templates/reference are
// re-upserted below). FK-safe order: children first, then break the
// department→user head FK, then users/employees/customers, then sequences.
async function clearData() {
  await prisma.department.updateMany({ data: { headUserId: null } });

  const steps = [
    "rateCard", "loadBoardPosting", "publicInquiry", "bankLcReferral",
    "auditLog", "outboxEvent", "notificationDelivery", "notification", "notificationPreference",
    "chatMessage", "chatChannelMember", "chatChannel", "document",
    "shipmentCharge", "payment", "invoiceLine", "invoice",
    "otcMilestone", "otdStep", "shipmentStatusHistory", "shipmentException", "task", "shipment",
    "quotationChargeLine", "quotation", "query",
    "visitPlan", "outreach", "leadStatusHistory", "lead",
    "refreshToken", "activationToken", "loginActivity",
    "user", "customer", "contact", "company", "employee",
    "vendor", "chargeType",
    "referenceSequence",
  ];
  for (const model of steps) {
    await prisma[model].deleteMany();
  }
  console.log(`✓ cleared ${steps.length} tables`);
}

/**
 * One active login per role + CEO reporting tree + department heads.
 *
 * Every write here is an upsert keyed on email, so this is safe to run against a
 * database holding live data — which is what makes `--accounts-only` the way to
 * provision a NEWLY ADDED role (e.g. transport_exec, ADR-046) without a wipe.
 */
export async function seedAccounts() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const depts = await prisma.department.findMany();
  const deptIdByCode = Object.fromEntries(depts.map((d) => [d.code, d.id]));

  const userIdByEmail = {};
  const empIdByEmail = {};
  for (const a of ACCOUNTS) {
    const email = a.email.toLowerCase();
    const employee = await prisma.employee.upsert({
      where: { email },
      update: { firstName: a.first, lastName: a.last, designation: a.role, departmentId: deptIdByCode[a.dept], isActive: true },
      create: { firstName: a.first, lastName: a.last, designation: a.role, email, departmentId: deptIdByCode[a.dept], isActive: true },
    });
    const user = await prisma.user.upsert({
      where: { email },
      update: { role: a.role, roles: [a.role], employeeId: employee.id, passwordHash, isActive: true },
      create: { email, role: a.role, roles: [a.role], employeeId: employee.id, passwordHash, isActive: true },
    });
    userIdByEmail[email] = user.id;
    empIdByEmail[email] = employee.id;
  }

  // Reporting tree — every employee reports to the CEO; the CEO is the root with
  // no manager (RULE-EMP-03: a valid, cycle-free hierarchy).
  const ceoEmpId = empIdByEmail["ceo@consort.test"];
  for (const [email, empId] of Object.entries(empIdByEmail)) {
    await prisma.employee.update({
      where: { id: empId },
      data: { managerId: email === "ceo@consort.test" ? null : ceoEmpId },
    });
  }

  // Department heads — powers the RULE-AE-03 assignment chain.
  for (const [code, email] of Object.entries(DEPT_HEADS)) {
    const headUserId = userIdByEmail[email.toLowerCase()];
    if (headUserId && deptIdByCode[code]) {
      await prisma.department.update({ where: { code }, data: { headUserId } });
    }
  }

  console.log(`✓ ${ACCOUNTS.length} accounts (all active, password: ${SEED_PASSWORD}); every employee reports to CEO`);
}

// Task-queue wording that reads better than the generic "Complete: <title>" — the
// customer-CRO step is a chase, not a filing.
const TASK_TITLE_OVERRIDES = {
  cro_received_from_customer: "Obtain CRO copy from customer",
};

/**
 * Seed the step catalog, its derived task templates and the charge catalog — and
 * NOTHING else. Safe to run against a database holding live shipments: it is
 * upsert/replace-in-place, never a wipe.
 *
 * Extracted from main() because the whole service-package feature is template-driven,
 * so template rows must be deployable on their own. `main()` wipes 40+ tables and can
 * only ever be run against a scratch database.
 *
 *   node prisma/seed.js --templates-only
 */
export async function seedTemplates() {
  // Departments first — step templates reference department codes.
  for (const d of DEPARTMENTS) {
    await prisma.department.upsert({ where: { code: d.code }, update: { name: d.name }, create: d });
  }

  // Replace the step catalog inside ONE transaction: the canonical numbers are
  // re-spaced, so an upsert-in-place would collide on canonical_no against the
  // previous catalog. Wrapping it means no request ever observes a missing template
  // (missingRequiredDocs and recomputeStatus both look templates up by stepCode).
  await prisma.$transaction(async (tx) => {
    // Sub-actions FK to the step catalog, so they clear first and rebuild last.
    await tx.otdStepActionTemplate.deleteMany();
    await tx.otdStepTemplate.deleteMany();
    for (const t of OTD_STEP_TEMPLATES) {
      await tx.otdStepTemplate.create({ data: t });
    }
    await tx.otdStepActionTemplate.createMany({ data: OTD_STEP_ACTION_TEMPLATES });

    // Task templates: one per composable step (eventCode 'otd.step' marks the
    // Action-Engine step chain; the engine matches by stepCode). Superseded steps get
    // no template — nothing composes them, so nothing can ever raise their task.
    await tx.taskTemplate.deleteMany({ where: { eventCode: "otd.step" } });
    await tx.taskTemplate.createMany({
      data: OTD_STEP_TEMPLATES.filter((t) => t.active !== false).map((t) => ({
        eventCode: "otd.step",
        stepCode: t.stepCode,
        title: TASK_TITLE_OVERRIDES[t.stepCode] ?? `Complete: ${t.title}`,
        description: `Submit/confirm "${t.title}" to advance the shipment.`,
        department: t.ownerDepartment,
        dueOffsetHours: t.dueOffsetHours,
        // The doc gate for a step whose pack lives in sub-actions is the union of
        // both sources — mirror it here so the task card lists the same files.
        requiredDocTypes: [
          ...new Set([
            ...t.requiredDocTypes,
            ...OTD_STEP_ACTION_TEMPLATES.filter((a) => a.stepCode === t.stepCode && a.kind === "document" && a.required)
              .map((a) => a.docType),
          ]),
        ],
      })),
    });
  });
  console.log(`✓ ${OTD_STEP_TEMPLATES.length} otd_step_templates (+${OTD_STEP_ACTION_TEMPLATES.length} sub-actions) + task_templates`);

  for (const ct of CHARGE_TYPES) {
    await prisma.chargeType.upsert({ where: { code: ct.code }, update: ct, create: ct });
  }
  console.log(`✓ ${CHARGE_TYPES.length} charge types`);
}

async function main() {
  // 0 — Wipe existing data first
  await clearData();

  // 1/2/3 — Departments, the step catalog, its task templates and the charge catalog
  await seedTemplates();
  console.log(`✓ ${DEPARTMENTS.length} departments`);

  // 4 — Reference data
  for (const p of PORTS) {
    await prisma.port.upsert({ where: { code: p.code }, update: p, create: p });
  }
  for (const c of CONTAINER_TYPES) {
    await prisma.containerType.upsert({ where: { code: c.code }, update: c, create: c });
  }
  console.log(`✓ ${PORTS.length} ports, ${CONTAINER_TYPES.length} container types`);

  // 4a — Demo vendors (the charge-type catalog is seeded by seedTemplates above)
  const seedYear = new Date().getFullYear();
  for (let i = 0; i < VENDORS.length; i++) {
    const v = VENDORS[i];
    await prisma.vendor.create({
      data: {
        ...v,
        referenceNo: `VEN-${seedYear}-${String(i + 1).padStart(5, "0")}`,
        normalizedName: v.name.trim().toLowerCase().replace(/\s+/g, " "),
      },
    });
  }
  await prisma.referenceSequence.upsert({
    where: { entity_year: { entity: "vendor", year: seedYear } },
    update: { lastValue: VENDORS.length },
    create: { entity: "vendor", year: seedYear, lastValue: VENDORS.length },
  });
  console.log(`✓ ${VENDORS.length} vendors`);

  // 4b — Storefront config: rate cards + load board postings (CRM_MASTER §5.20)
  await prisma.rateCard.createMany({ data: RATE_CARDS });
  const year = new Date().getFullYear();
  for (let i = 0; i < LOAD_BOARD_POSTINGS.length; i++) {
    const p = LOAD_BOARD_POSTINGS[i];
    const { departureInDays, ...rest } = p;
    await prisma.loadBoardPosting.create({
      data: {
        ...rest,
        referenceNo: `LB-${year}-${String(i + 1).padStart(5, "0")}`,
        currency: "USD",
        departureDate: new Date(Date.now() + departureInDays * DAY),
        validUntil: new Date(Date.now() + (departureInDays + 14) * DAY),
      },
    });
  }
  // Keep the runtime allocator in step with the manually-numbered seed refs.
  await prisma.referenceSequence.upsert({
    where: { entity_year: { entity: "load_board", year } },
    update: { lastValue: LOAD_BOARD_POSTINGS.length },
    create: { entity: "load_board", year, lastValue: LOAD_BOARD_POSTINGS.length },
  });
  console.log(`✓ ${RATE_CARDS.length} rate cards, ${LOAD_BOARD_POSTINGS.length} load board postings`);

  // 5 — Bootstrap accounts (one active login per role + CEO reporting tree + heads)
  await seedAccounts();

  console.log("Seed complete.");
}

// The step catalog is exported so composition can be exercised without a database.
export { OTD_STEP_TEMPLATES };

// Only seed when run as a script — importing this file (to read the catalog) must not
// connect to a database or wipe anything.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  // Two non-destructive subsets, the only forms safe to run against a database that
  // already holds real work. Bare `node prisma/seed.js` WIPES 40+ tables.
  //   --templates-only  step/task/charge catalogs (upsert/replace-in-place)
  //   --accounts-only   role logins, reporting tree, department heads (all upserts)
  const templatesOnly = process.argv.includes("--templates-only");
  const accountsOnly = process.argv.includes("--accounts-only");

  const run = templatesOnly && accountsOnly
    ? seedTemplates().then(seedAccounts)
    : templatesOnly
      ? seedTemplates()
      : accountsOnly
        ? seedAccounts()
        : main();

  run
    .then(() => {
      if (templatesOnly || accountsOnly) console.log("Partial seed complete (no data was cleared).");
    })
    .catch((e) => {
      console.error("Seed failed:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
