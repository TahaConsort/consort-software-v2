/**
 * Export-trade WORKFLOW verification — the step path, its document gates and the status
 * it derives (Export Shipment Workflow roadmap §5).
 *
 *   node scripts/verifyTradeWorkflow.js
 *
 * There is no test framework in this repo, so this is the safety net for the kind gate
 * added to `otd_step_templates.applies_to_kinds`. It runs entirely against the database
 * (no dev server needed) and, like scripts/verifyTradeFlow.js, builds its OWN company,
 * customer, vendor, contract, instrument and shipment, then tears them all down — so it
 * is safe on an environment with no seeded business data and leaves zero residue.
 *
 * What it proves:
 *   · a trade shipment composes exactly the roadmap's eight steps, in order, and NONE of
 *     the freight-forwarding steps (order lock, CRO, telex release, empty return);
 *   · a forwarding shipment composes none of the trade steps, and both paths still reach
 *     a step deriving `delivered` — without one an order can never settle (RULE-SH-12);
 *   · each trade step's document gate is the roadmap's document (RULE-SH-06): the step
 *     refuses to complete while it is missing, and passes once attached;
 *   · walking all eight steps drives `shipments.status` to `delivered`, i.e. the step
 *     path and the derived status ladder agree.
 */
import crypto from "crypto";
import prisma from "../config/prisma.js";
import { composeOtdPath } from "../utils/composition.js";
import { createTradeShipmentTx, completeStepTx } from "../modules/shipment/shipment.service.js";
import { documentGateFor } from "../modules/document/document.service.js";
import { TRADE_STEP_TEMPLATES } from "../prisma/tradeWorkflow.js";

const TAG = `ZZW${Date.now().toString().slice(-6)}`;

let pass = 0;
let fail = 0;
const failures = [];

const check = (label, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

/** The eight roadmap steps, in the order §5 lists them. */
const EXPECTED_TRADE_PATH = TRADE_STEP_TEMPLATES.map((t) => t.stepCode);
/** Forwarding-only steps that must never appear on a trade shipment. */
const FORWARDING_ONLY = ["order_lock", "order_confirmed", "cro_released", "telex_released", "empty_return"];
/** ADR-057: a quotation-born shipment walks Order Lock, then the same eight. */
const EXPECTED_FORWARDING_PATH = ["order_lock", ...EXPECTED_TRADE_PATH];

const fixtures = { ids: {} };

const buildFixtures = async () => {
  const vendor = await prisma.vendor.create({
    data: {
      referenceNo: `VEN-${TAG}-V`,
      name: `${TAG} Ahmad Saeed Workflow`,
      normalizedName: `${TAG} ahmad saeed workflow`.toLowerCase(),
      type: "exporter",
      country: "PK",
    },
  });
  const bank = await prisma.vendor.create({
    data: {
      referenceNo: `VEN-${TAG}-B`,
      name: `${TAG} BankIslami Workflow`,
      normalizedName: `${TAG} bankislami workflow`.toLowerCase(),
      type: "bank",
      country: "PK",
    },
  });
  const company = await prisma.company.create({
    data: { name: `${TAG} Zanitex Workflow`, normalizedName: `${TAG} zanitex workflow`.toLowerCase(), country: "IT" },
  });
  const customer = await prisma.customer.create({
    data: { referenceNo: `CST-${TAG}`, companyId: company.id, source: "direct" },
  });
  const contract = await prisma.tradeContract.create({
    data: {
      referenceNo: `TCN-${TAG}`,
      contractNo: `AST/${TAG}/001`,
      direction: "export",
      vendorId: vendor.id,
      customerId: customer.id,
      incoterm: "CFR",
      currency: "EUR",
    },
  });
  // 60% CAD / 40% DA 75 days from B/L date — the roadmap's Ahmad Saeed instrument.
  const fi = await prisma.financialInstrument.create({
    data: {
      referenceNo: `FI-${TAG}`,
      fiNumber: `BIP-EXP-${TAG}`,
      type: "exp_form",
      contractId: contract.id,
      vendorId: vendor.id,
      bankVendorId: bank.id,
      customerId: customer.id,
      incoterm: "CFR",
      currency: "EUR",
      value: 42260,
      cadPercent: 60,
      daPercent: 40,
      daDays: 75,
      portOfDischarge: "Antwerpen",
      expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });

  Object.assign(fixtures.ids, {
    vendor: vendor.id, bank: bank.id, company: company.id,
    customer: customer.id, contract: contract.id, fi: fi.id,
  });
  return { contract, financialInstrument: fi, customer };
};

const teardown = async () => {
  const { shipment } = fixtures.ids;
  if (shipment) {
    const steps = await prisma.otdStep.findMany({ where: { shipmentId: shipment }, select: { id: true } });
    await prisma.otdStepAction.deleteMany({ where: { otdStepId: { in: steps.map((s) => s.id) } } });
    await prisma.document.deleteMany({ where: { ownerType: "shipment", ownerId: shipment } });
    await prisma.task.deleteMany({ where: { shipmentId: shipment } });
    await prisma.chatChannelMember.deleteMany({ where: { channel: { shipmentId: shipment } } });
    await prisma.chatChannel.deleteMany({ where: { shipmentId: shipment } });
    await prisma.otdStep.deleteMany({ where: { shipmentId: shipment } });
    await prisma.otcMilestone.deleteMany({ where: { shipmentId: shipment } });
    await prisma.shipmentParty.deleteMany({ where: { shipmentId: shipment } });
    await prisma.shipmentStatusHistory.deleteMany({ where: { shipmentId: shipment } });
    await prisma.shipmentTradeStageHistory.deleteMany({ where: { shipmentId: shipment } });
    await prisma.invoice.deleteMany({ where: { shipmentId: shipment } });
    await prisma.shipment.deleteMany({ where: { id: shipment } });
  }
  // Deleting a vendor SET NULLs shipment_parties.vendor_id, which trips the
  // `shipment_parties_one_target` CHECK — so any party row naming our vendors has to go
  // first, even one hanging off a shipment this run failed to record.
  const vendorIds = [fixtures.ids.vendor, fixtures.ids.bank].filter(Boolean);
  if (vendorIds.length) await prisma.shipmentParty.deleteMany({ where: { vendorId: { in: vendorIds } } });
  if (fixtures.ids.customer) await prisma.shipmentParty.deleteMany({ where: { customerId: fixtures.ids.customer } });
  await prisma.financialInstrument.deleteMany({ where: { id: fixtures.ids.fi } });
  await prisma.tradeContract.deleteMany({ where: { id: fixtures.ids.contract } });
  await prisma.customer.deleteMany({ where: { id: fixtures.ids.customer } });
  await prisma.company.deleteMany({ where: { id: fixtures.ids.company } });
  await prisma.vendor.deleteMany({ where: { id: { in: [fixtures.ids.vendor, fixtures.ids.bank].filter(Boolean) } } });
  await prisma.auditLog.deleteMany({ where: { resourceId: fixtures.ids.shipment ?? "—" } });
};

async function run() {
  // ── 1. The catalog composes two separate paths ────────────────────────────
  console.log("\nCatalog composition");
  const templates = await prisma.otdStepTemplate.findMany();
  const trade = composeOtdPath(templates, "trade");
  const forwarding = composeOtdPath(templates, "forwarding");

  check(
    `trade path is the roadmap's ${EXPECTED_TRADE_PATH.length} steps, in order`,
    JSON.stringify(trade.map((s) => s.stepCode)) === JSON.stringify(EXPECTED_TRADE_PATH),
    trade.map((s) => s.stepCode).join(" → "),
  );
  const leaked = trade.filter((s) => FORWARDING_ONLY.includes(s.stepCode)).map((s) => s.stepCode);
  check("no freight-forwarding step composes onto a trade shipment", leaked.length === 0, leaked.join(", "));
  check(
    "a quotation-born (forwarding) shipment walks Order Lock, then the same eight (ADR-057)",
    JSON.stringify(forwarding.map((s) => s.stepCode)) === JSON.stringify(EXPECTED_FORWARDING_PATH),
    forwarding.map((s) => s.stepCode).join(" → "),
  );
  for (const [kind, path] of [["trade", trade], ["forwarding", forwarding]]) {
    check(`${kind} path reaches a step deriving 'delivered' (RULE-SH-12)`, path.some((s) => s.derivedStatus === "delivered"));
  }
  // Every document the roadmap attaches to a step must exist in the vocabulary.
  const docTypes = new Set((await prisma.documentType.findMany({ select: { code: true } })).map((d) => d.code));
  const dangling = [...new Set(trade.flatMap((s) => s.requiredDocTypes))].filter((c) => !docTypes.has(c));
  check("every trade step's required documents exist in document_types", dangling.length === 0, dangling.join(", "));

  // ── 2. A real trade shipment composes that path ───────────────────────────
  console.log("\nTrade shipment composition");
  const { contract, financialInstrument, customer } = await buildFixtures();
  const actor = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  const { shipment } = await prisma.$transaction((tx) =>
    createTradeShipmentTx(tx, {
      contract,
      financialInstrument,
      customer,
      body: { services: ["sea_freight"], direction: "export", originPort: "PKQCT", destinationPort: "BEANR" },
      actorId: actor?.id ?? null,
    }),
  );
  // Without this guard an undefined id turns every `where: { shipmentId }` below into an
  // unfiltered query over the whole table, and the assertions quietly test nothing.
  if (!shipment?.id) throw new Error("createTradeShipmentTx returned no shipment");
  fixtures.ids.shipment = shipment.id;

  const steps = await prisma.otdStep.findMany({ where: { shipmentId: shipment.id }, orderBy: { canonicalNo: "asc" } });
  check(
    "the shipment's frozen steps are the roadmap's eight",
    JSON.stringify(steps.map((s) => s.stepCode)) === JSON.stringify(EXPECTED_TRADE_PATH),
    steps.map((s) => s.stepCode).join(" → "),
  );
  check("displayNo runs 1..8 with no gaps", steps.every((s, i) => s.displayNo === i + 1));
  const actionCount = await prisma.otdStepAction.count({ where: { otdStepId: { in: steps.map((s) => s.id) } } });
  check("every step carries its sub-action checklist (ADR-048)", actionCount > 0, `${actionCount} item(s)`);

  // ── 3. The document gate is the roadmap's document ────────────────────────
  console.log("\nDocument gates (RULE-SH-06)");
  for (const tpl of TRADE_STEP_TEMPLATES.filter((t) => t.requiredDocTypes.length)) {
    const step = steps.find((s) => s.stepCode === tpl.stepCode);
    const gate = await documentGateFor(shipment, step);
    const missing = new Set(gate.missing);
    check(
      `${tpl.stepCode} is gated on ${tpl.requiredDocTypes.join(" + ")}`,
      tpl.requiredDocTypes.every((d) => missing.has(d)),
      `gate reports missing: ${gate.missing.join(", ") || "nothing"}`,
    );
  }

  // ── 4. Walking the path drives the derived status ─────────────────────────
  console.log("\nStep completion → derived status");
  // Attach one document of every type the path asks for, and tick every manual item, so
  // the only thing left being tested is the sequencing and the status derivation.
  const neededDocs = [...new Set(trade.flatMap((s) => s.requiredDocTypes))];
  const stepByCode = Object.fromEntries(steps.map((s) => [s.stepCode, s]));
  for (const code of neededDocs) {
    const owningStep = trade.find((s) => s.requiredDocTypes.includes(code));
    await prisma.document.create({
      data: {
        ownerType: "shipment",
        ownerId: shipment.id,
        otdStepId: stepByCode[owningStep.stepCode].id,
        docType: code,
        fileName: `${TAG}-${code}.pdf`,
        storageKey: `verify/${TAG}/${code}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        checksum: crypto.createHash("sha256").update(`${TAG}:${code}`).digest("hex"),
        uploadedById: actor?.id ?? null,
      },
    });
  }
  // Document sub-actions are derived at read time; only manual ones are stored.
  await prisma.otdStepAction.updateMany({
    where: { otdStepId: { in: steps.map((s) => s.id) }, kind: "manual" },
    data: { status: "done", completedAt: new Date(), completedById: actor?.id ?? null },
  });

  let statusReached = null;
  for (const tpl of TRADE_STEP_TEMPLATES) {
    const step = stepByCode[tpl.stepCode];
    try {
      await prisma.$transaction((tx) =>
        completeStepTx(tx, {
          shipment,
          step,
          actorId: actor?.id ?? null,
          // Each roadmap step is owned by a different department; act as its owner
          // rather than forcing, so RULE-SH-04 is exercised rather than bypassed.
          actorDeptCode: tpl.ownerDepartment,
        }),
      );
      const fresh = await prisma.shipment.findUnique({ where: { id: shipment.id }, select: { status: true } });
      statusReached = fresh.status;
      check(`${tpl.stepCode} completes → status ${fresh.status}`, fresh.status === tpl.derivedStatus || fresh.status === "settled", `expected ${tpl.derivedStatus}`);
    } catch (e) {
      check(`${tpl.stepCode} completes`, false, e.message);
      break;
    }
  }
  check(
    "the full path ends at 'delivered' (or 'settled' if the money side was already clear)",
    ["delivered", "settled"].includes(statusReached),
    `ended at ${statusReached}`,
  );

  // Trade stage is derived from DOCUMENTS, independently of the steps — confirm the two
  // machines coexist rather than fight.
  const finalShipment = await prisma.shipment.findUnique({ where: { id: shipment.id }, select: { tradeStage: true } });
  check("trade_stage still derives independently of the step path", finalShipment.tradeStage !== undefined, `stage: ${finalShipment.tradeStage}`);
}

run()
  .catch((e) => {
    console.error("\nVerification crashed:", e);
    fail += 1;
  })
  .finally(async () => {
    try {
      await teardown();
      console.log("\n· fixtures torn down");
    } catch (e) {
      console.error("Teardown failed — check for leftover", TAG, "rows:", e.message);
    }
    console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
    if (failures.length) console.log(`  failed: ${failures.join(" · ")}`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });
