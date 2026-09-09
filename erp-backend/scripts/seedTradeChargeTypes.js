/**
 * Add the terminal and forwarder charge vocabulary the export roadmap itemises
 * (Export_Shipment_Workflow_CRM_Roadmap §4.7/§4.8) to `charge_types`.
 *
 *   node scripts/seedTradeChargeTypes.js
 *
 * Idempotent upsert of these rows and nothing else — deliberately NOT `prisma/seed.js`,
 * which rebuilds the step catalog and would be the wrong tool against a database
 * carrying live data. Existing rows keep their direction and step hints; only the label
 * is restated, exactly like scripts/seedMasterDataDocTypes.js.
 *
 * Every one of these appears as a separate line on the QICT invoice in the sample set,
 * each carrying 15% Sindh Sales Tax — which is why InvoiceLine now has `chargeCode`,
 * `taxPercent` and `taxAmount`.
 */
import prisma from "../config/prisma.js";
import { CHARGE_TYPE_STEP_REMAP } from "../prisma/tradeWorkflow.js";

// The step each charge lands on is the roadmap step (ADR-057) — one map, shared with the
// seed, so a retired forwarding step code can never be reintroduced here by hand.
const TYPES = [
  // Qasim International Container Terminal — §4.7
  { code: "seal_breaking", label: "Seal Breaking / Affixing", service: "port_handling" },
  { code: "customs_seal", label: "Customs Seal", service: "port_handling" },
  { code: "data_processing", label: "Data Processing Charges", service: "port_handling" },
  { code: "document_copying", label: "Document Copying", service: "port_handling" },
  { code: "export_examination", label: "Export Examination", service: "customs_clearance" },
  { code: "examination_survey", label: "Examination Survey", service: "customs_clearance" },
  { code: "fuel_adjustment", label: "Fuel Adjustment Factor", service: "port_handling" },
  { code: "general_cargo_handling", label: "General Cargo Handling", service: "port_handling" },
  { code: "pqa_wharfage", label: "PQA Wharfage", service: "port_handling" },
  { code: "container_weighment", label: "Container Weighment (VGM)", service: "port_handling" },
  { code: "bank_service_charge", label: "Bank Service Charge", service: null },
  // Freight forwarder — §4.8
  { code: "bl_fee", label: "Bill of Lading Fee", service: "sea_freight" },
  { code: "cro_release", label: "CRO (Container Release Order)", service: "port_handling" },
  { code: "seal_charge", label: "Seal Charge", service: "port_handling" },
].map((t) => ({ ...t, step: CHARGE_TYPE_STEP_REMAP[t.code] ?? null }));

async function run() {
  let created = 0;
  let updated = 0;

  for (const t of TYPES) {
    const existing = await prisma.chargeType.findUnique({ where: { code: t.code } });
    await prisma.chargeType.upsert({
      where: { code: t.code },
      update: { label: t.label },
      create: {
        code: t.code,
        label: t.label,
        // Every one of these is money OUT: a terminal or a forwarder billing us.
        defaultDirection: "payable",
        defaultStepCode: t.step,
        service: t.service,
        isActive: true,
      },
    });
    if (existing) updated += 1;
    else created += 1;
  }

  console.log(`✓ charge types — ${created} created, ${updated} already present (labels restated)`);
}

run()
  .catch((err) => {
    console.error("✗ failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
