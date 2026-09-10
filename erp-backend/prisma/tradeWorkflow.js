/**
 * THE shipment workflow — Export Shipment Workflow roadmap §4 and §5 (ADR-057).
 *
 * ONE source for the roadmap path (ADR-001). `prisma/seed.js` splices these into the
 * factory catalog so a fresh environment is correct, and `scripts/applyRoadmapWorkflow.js`
 * upserts the same rows onto a live database without the factory reset that would
 * destroy admin edits. Neither re-encodes them.
 *
 * Every shipment walks these eight steps, whichever way it was born: a quotation-born
 * (`forwarding`) shipment carries Order Lock in front of them — the customer's signed
 * Rate Confirmation (ADR-056 / RULE-QT-09) — and a contract-born (`trade`) shipment
 * starts straight at Step 1. The former seventeen-step freight-forwarding path (CRO,
 * telex release, destination delivery order, empty return…) is retired: its rows stay
 * inactive so shipments composed while it was live still resolve by step code (INV-14).
 */

/**
 * Roadmap §4's document register. The other four documents it names — packing list,
 * commercial invoice, Bill of Lading and Goods Declaration — already exist in the
 * factory vocabulary.
 *
 * None are `customerUploadable`: they are raised by the vendor and its agents, not by
 * the portal customer. `sortOrder` continues the factory block and stays clear of the
 * master-data types at 510+.
 */
export const TRADE_DOCUMENT_TYPES = [
  { code: "trade_contract", label: "Sales Contract / Proforma Invoice", customerUploadable: false, requiresVerification: false, sortOrder: 250 },
  { code: "financial_instrument", label: "Financial Instrument (Bank EXP Registration)", customerUploadable: false, requiresVerification: false, sortOrder: 260 },
  { code: "terminal_invoice", label: "Port / Terminal Handling Invoice", customerUploadable: false, requiresVerification: false, sortOrder: 270 },
  { code: "forwarder_invoice", label: "Freight Forwarder's Invoice", customerUploadable: false, requiresVerification: false, sortOrder: 280 },
];

/** Both kinds compose the roadmap path (ADR-057). */
const BOTH_KINDS = ["forwarding", "trade"];

/**
 * Roadmap §5, one step per stage. Numbered from 200 so they sit after Order Lock (10)
 * and clear of the retired forwarding rows, and nothing ever needs renumbering.
 *
 * `derivedStatus` reuses a forwarding status wherever one honestly fits; §5 steps 2,
 * 3 and 6 had no equivalent, hence `packing_confirmed` / `invoice_raised` /
 * `logistics_settled` on ShipmentStatus. Step 8 MUST derive `delivered` — it is the last
 * step of the path, and maybeSettleTx only tests the settle rule there (RULE-SH-12).
 *
 * Step 1's gate is the two REGISTERS, not two PDFs (product decision 2026-09-09): a Trade
 * Contract and an active Financial Instrument linked to the shipment are what let the
 * §7.2 alerts (instrument expiry, DA maturity, drawdowns) run at all. `requiredDocTypes`
 * is therefore empty on it — the `record` sub-actions below carry the requirement.
 */
export const TRADE_STEP_TEMPLATES = [
  { canonicalNo: 200, stepCode: "trade_contract_registered", title: "BRD / Contract & Financial Instrument Registration",
    ownerDepartment: "finance", appliesToKinds: BOTH_KINDS,
    requiredDocTypes: [], dueOffsetHours: 72, derivedStatus: "lc_generated" },
  { canonicalNo: 210, stepCode: "trade_production_packing", title: "Production & Packing",
    ownerDepartment: "operations", appliesToKinds: BOTH_KINDS,
    requiredDocTypes: ["packing_list"], dueOffsetHours: 72, derivedStatus: "packing_confirmed" },
  { canonicalNo: 220, stepCode: "trade_invoicing", title: "Commercial Invoicing",
    ownerDepartment: "finance", appliesToKinds: BOTH_KINDS,
    requiredDocTypes: ["commercial_invoice"], dueOffsetHours: 48, derivedStatus: "invoice_raised" },
  // Owned by compliance: the Goods Declaration is the gating artifact. The forwarder's
  // vessel booking is a manual sub-action inside the same step (roadmap Step 4).
  { canonicalNo: 230, stepCode: "trade_booking_customs", title: "Booking & Customs Filing",
    ownerDepartment: "compliance", appliesToKinds: BOTH_KINDS,
    requiredDocTypes: ["gd"], dueOffsetHours: 72, derivedStatus: "vessel_booked" },
  { canonicalNo: 240, stepCode: "trade_bol_issued", title: "Loading & Bill of Lading",
    ownerDepartment: "operations", appliesToKinds: BOTH_KINDS,
    requiredDocTypes: ["bol"], dueOffsetHours: 48, derivedStatus: "bol_issued" },
  { canonicalNo: 250, stepCode: "trade_logistics_settlement", title: "Forwarder & Terminal Settlement",
    ownerDepartment: "finance", appliesToKinds: BOTH_KINDS,
    requiredDocTypes: ["terminal_invoice", "forwarder_invoice"], dueOffsetHours: 72, derivedStatus: "logistics_settled" },
  { canonicalNo: 260, stepCode: "trade_collection", title: "Bank Collection / Settlement (CAD & DA)",
    ownerDepartment: "finance", appliesToKinds: BOTH_KINDS,
    requiredDocTypes: ["bank_receipt"], dueOffsetHours: 72, derivedStatus: "bol_submitted" },
  { canonicalNo: 270, stepCode: "trade_closure", title: "Financial Instrument Closure",
    ownerDepartment: "finance", appliesToKinds: BOTH_KINDS,
    requiredDocTypes: [], dueOffsetHours: 48, derivedStatus: "delivered" },
];

/** One plain-language line per step, merged onto the rows at write time (ADR-051). */
export const TRADE_STEP_HINTS = {
  trade_contract_registered: "Register the customer's BRD/PO as a Trade Contract and link the Financial Instrument (EXP form) the vendor's bank issued against it — both from the Trade Registers. Everything downstream quotes these two numbers, and the instrument's expiry and DA clock run from here.",
  trade_production_packing: "The vendor's factory manufactures and packs the goods per SKU. Confirm the packing list — its carton, piece and weight totals are what the invoice and B/L are checked against.",
  trade_invoicing: "The vendor raises the commercial invoice against the contract and instrument, quoting its REX registration. Its value draws down the instrument.",
  trade_booking_customs: "The forwarder books vessel space and the clearing agent files the Goods Declaration in WeBOC/PSW. Work the checklist below — the terminal assesses its handling charges once the container arrives.",
  trade_bol_issued: "The carrier issues the Bill of Lading once the container is on board. Check the consignee and notify party against the instrument — the B/L date starts the DA clock.",
  trade_logistics_settlement: "Settle what the move actually cost: the terminal's handling invoice and the forwarder's invoice (ocean freight, B/L fee, CRO, seal, LOLO, clearance).",
  trade_collection: "Route the shipping documents through the vendor's bank on the instrument's terms — the CAD portion on presentation, the DA portion on the agreed usance date.",
  trade_closure: "Full proceeds realised and documents settled: the bank closes the Financial Instrument and the shipment is archived. This is the last step of the path.",
};

/**
 * Sub-action checklists (ADR-048). Each roadmap stage bundles several parties; they are
 * sub-actions rather than extra steps because the roadmap treats each stage as one
 * milestone and one department works it end to end — splitting them would 403 across a
 * handoff for no benefit. A `document` item is satisfied by a live document of that type;
 * a `record` item by the named register linked to the shipment; a `manual` item is
 * ticked by the step's owning department.
 */
export const TRADE_STEP_ACTION_TEMPLATES = [
  // Step 1 — the contract and the bank registration behind the job.
  // The two `record` items that used to gate this step were satisfied only by linking a
  // Trade Contract / Financial Instrument from the trade registers. Those registers are
  // removed, and otd.controllers refuses to tick a `record` item by hand (409), so they
  // would have frozen Step 1 — and every shipment behind it — with no way through.
  { stepCode: "trade_contract_registered", actionCode: "contract_doc",    title: "Signed contract / proforma scan attached",           kind: "document", docType: "trade_contract",       recordType: null,                   sortOrder: 30, required: true },
  { stepCode: "trade_contract_registered", actionCode: "fi_doc",          title: "Bank's EXP registration scan attached",              kind: "document", docType: "financial_instrument", recordType: null,                   sortOrder: 40, required: true },
  { stepCode: "trade_contract_registered", actionCode: "terms_confirmed", title: "Incoterm & payment terms (CAD/DA split) confirmed",  kind: "manual",   docType: null,                   recordType: null,                   sortOrder: 50, required: true },

  // Step 2 — the packing list totals are what §7.2's mismatch checks compare against.
  { stepCode: "trade_production_packing", actionCode: "packing_list_doc", title: "Packing list attached",                               kind: "document", docType: "packing_list", recordType: null, sortOrder: 10, required: true },
  { stepCode: "trade_production_packing", actionCode: "goods_packed",     title: "Goods manufactured & packed per SKU",                 kind: "manual",   docType: null,           recordType: null, sortOrder: 20, required: true },
  { stepCode: "trade_production_packing", actionCode: "totals_confirmed", title: "Carton, piece and net/gross weight totals confirmed", kind: "manual",   docType: null,           recordType: null, sortOrder: 30, required: true },

  // Step 3 — §4.4: the invoice carries the contract, FI and REX numbers.
  { stepCode: "trade_invoicing", actionCode: "invoice_doc",  title: "Commercial invoice attached",                          kind: "document", docType: "commercial_invoice", recordType: null, sortOrder: 10, required: true },
  { stepCode: "trade_invoicing", actionCode: "invoice_refs", title: "Invoice references the contract & instrument numbers", kind: "manual",   docType: null,                 recordType: null, sortOrder: 20, required: true },
  { stepCode: "trade_invoicing", actionCode: "rex_quoted",   title: "Vendor's REX registration quoted",                     kind: "manual",   docType: null,                 recordType: null, sortOrder: 30, required: true },

  // Step 4 — three parties in one stage: forwarder books, clearing agent files, terminal bills.
  { stepCode: "trade_booking_customs", actionCode: "space_booked",      title: "Vessel space booked with the ocean carrier", kind: "manual",   docType: null, recordType: null, sortOrder: 10, required: true },
  { stepCode: "trade_booking_customs", actionCode: "gd_filed",          title: "Goods Declaration filed in WeBOC / PSW",     kind: "manual",   docType: null, recordType: null, sortOrder: 20, required: true },
  { stepCode: "trade_booking_customs", actionCode: "gd_doc",            title: "Goods Declaration (GD-I) attached",          kind: "document", docType: "gd", recordType: null, sortOrder: 30, required: true },
  { stepCode: "trade_booking_customs", actionCode: "duty_paid",         title: "Duty & taxes paid",                          kind: "manual",   docType: null, recordType: null, sortOrder: 40, required: true },
  { stepCode: "trade_booking_customs", actionCode: "terminal_assessed", title: "Terminal handling charges assessed",         kind: "manual",   docType: null, recordType: null, sortOrder: 50, required: true },

  // Step 5 — the B/L date starts the DA clock, so it is checked, not just filed (§7.2).
  { stepCode: "trade_bol_issued", actionCode: "bol_doc",          title: "Bill of Lading attached",                                  kind: "document", docType: "bol", recordType: null, sortOrder: 10, required: true },
  { stepCode: "trade_bol_issued", actionCode: "shipped_on_board", title: "Shipped-on-board date confirmed",                          kind: "manual",   docType: null,  recordType: null, sortOrder: 20, required: true },
  { stepCode: "trade_bol_issued", actionCode: "parties_checked",  title: "Consignee & notify party verified against the instrument", kind: "manual",   docType: null,  recordType: null, sortOrder: 30, required: true },

  // Step 6 — §4.7 and §4.8, the two logistics bills.
  { stepCode: "trade_logistics_settlement", actionCode: "terminal_invoice_doc",  title: "Port / terminal handling invoice attached", kind: "document", docType: "terminal_invoice",  recordType: null, sortOrder: 10, required: true },
  { stepCode: "trade_logistics_settlement", actionCode: "forwarder_invoice_doc", title: "Freight forwarder's invoice attached",      kind: "document", docType: "forwarder_invoice", recordType: null, sortOrder: 20, required: true },
  { stepCode: "trade_logistics_settlement", actionCode: "payables_settled",      title: "Logistics payables settled",                kind: "manual",   docType: null,                recordType: null, sortOrder: 30, required: true },

  // Step 7 — the CAD portion on presentation, the DA portion on the usance date (§5 Step 7).
  { stepCode: "trade_collection", actionCode: "bank_receipt_doc", title: "Bank submission receipt attached",         kind: "document", docType: "bank_receipt", recordType: null, sortOrder: 10, required: true },
  { stepCode: "trade_collection", actionCode: "docs_presented",   title: "Shipping documents presented to the bank", kind: "manual",   docType: null,           recordType: null, sortOrder: 20, required: true },
  { stepCode: "trade_collection", actionCode: "cad_collected",    title: "CAD portion collected on presentation",    kind: "manual",   docType: null,           recordType: null, sortOrder: 30, required: true },
  { stepCode: "trade_collection", actionCode: "da_accepted",      title: "DA portion accepted for the usance date",  kind: "manual",   docType: null,           recordType: null, sortOrder: 40, required: true },

  // Step 8 — §5 Step 8. No document: closure is the bank's act, recorded on the instrument.
  { stepCode: "trade_closure", actionCode: "proceeds_realised", title: "Full export proceeds realised",           kind: "manual", docType: null, recordType: null, sortOrder: 10, required: true },
  { stepCode: "trade_closure", actionCode: "fi_closed",         title: "Financial Instrument closed by the bank", kind: "manual", docType: null, recordType: null, sortOrder: 20, required: true },
  { stepCode: "trade_closure", actionCode: "shipment_archived", title: "Shipment record archived",                kind: "manual", docType: null, recordType: null, sortOrder: 30, required: true },
];

/**
 * Where each factory charge type's money usually lands on the roadmap path — the
 * `charge_types.default_step_code` remap that retires the forwarding step codes. Read by
 * the seed and by the live-apply script; a code missing here keeps whatever it has.
 */
export const CHARGE_TYPE_STEP_REMAP = {
  ocean_freight: "trade_booking_customs",
  cro_charges: "trade_booking_customs",
  customs_clearance: "trade_booking_customs",
  port_handling: "trade_booking_customs",
  lolo: "trade_booking_customs",
  inland_transport: "trade_booking_customs",
  fuel_surcharge: "trade_production_packing",
  loading_labour: "trade_production_packing",
  documentation_fee: "trade_bol_issued",
  // Rail carriage buys its space at the same stage ocean freight does.
  rail_freight: "trade_booking_customs",
  rail_terminal_handling: "trade_booking_customs",
  wagon_detention: "trade_logistics_settlement",
  do_fee: "trade_logistics_settlement",
  agency_fee: "trade_logistics_settlement",
  lc_charges: "trade_collection",
  // scripts/seedTradeChargeTypes.js — the QICT / forwarder line items.
  seal_breaking: "trade_booking_customs",
  customs_seal: "trade_booking_customs",
  data_processing: "trade_booking_customs",
  document_copying: "trade_booking_customs",
  export_examination: "trade_booking_customs",
  examination_survey: "trade_booking_customs",
  fuel_adjustment: "trade_booking_customs",
  general_cargo_handling: "trade_booking_customs",
  pqa_wharfage: "trade_booking_customs",
  container_weighment: "trade_booking_customs",
  bl_fee: "trade_bol_issued",
  cro_release: "trade_booking_customs",
  seal_charge: "trade_booking_customs",
};
