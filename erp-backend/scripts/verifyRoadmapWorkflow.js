/**
 * One shipment workflow — the roadmap path for every shipment (ADR-057) — verification.
 *
 *   node scripts/verifyRoadmapWorkflow.js        (needs the dev server on :5000, and
 *                                                 scripts/applyRoadmapWorkflow.js --apply run)
 *
 * There is no test framework in this repo, so this is the safety net for the change that
 * retired the seventeen-step freight-forwarding path: every shipment now walks the
 * roadmap's eight steps, a quotation-born one with Order Lock in front. It builds its own
 * vendors, bank, customers, contracts, instruments, queries and quotations, drives the
 * pivot and the new endpoints as real users, and tears everything down — zero residue.
 *
 * What it proves:
 *   · the catalog: forwarding = Order Lock + the eight; trade = the eight; the forwarding
 *     steps are inactive with dormant task templates; charge types land on live steps;
 *     the roadmap's party directory exists exactly once;
 *   · a quotation-born shipment composes that path, with the quotation PDF on Step 1,
 *     the RC on Order Lock and the customer as a party;
 *   · Step 1 refuses until BOTH registers are linked; linking refuses another customer's
 *     contract, another vendor's or an inactive instrument, an instrument already taken,
 *     and a locked shipment; a good link seeds the parties and derives the trade stage;
 *   · recompose migrates an untouched shipment off the retired path and re-hangs its
 *     documents, and leaves one with work recorded alone;
 *   · the Workflow admin accepts a `record` item and rejects one without a register.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { composeOtdPath } from "../utils/composition.js";
import { createShipmentFromApproval, completeStepTx } from "../modules/shipment/shipment.service.js";
import { UPLOAD_ROOT } from "../modules/document/document.service.js";
import { recomposeUntouched } from "./applyRoadmapWorkflow.js";
import { TRADE_STEP_TEMPLATES } from "../prisma/tradeWorkflow.js";
import { ROADMAP_PARTIES, normalizeVendorName } from "../prisma/roadmapParties.js";

const BASE = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:5000/api";
const PASSWORD = process.env.PASSWORD ?? "1234567";
const TAG = `ZZR${Date.now().toString().slice(-6)}`;
const DAY = 24 * 60 * 60 * 1000;

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

const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body: json };
};
const login = async (email) => {
  const r = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
  if (!r.body?.accessToken) throw new Error(`login ${email} failed: ${r.status}`);
  return { token: r.body.accessToken, user: r.body.user };
};

const ROADMAP = TRADE_STEP_TEMPLATES.map((t) => t.stepCode);
const FORWARDING_PATH = ["order_lock", ...ROADMAP];

const f = { shipments: [], quotations: [], queries: [], customers: [], companies: [], vendors: [], contracts: [], fis: [] };

const makeCustomer = async (n) => {
  const company = await prisma.company.create({
    data: { name: `${TAG} Customer ${n}`, normalizedName: `${TAG} customer ${n}`.toLowerCase(), country: "PK" },
  });
  const customer = await prisma.customer.create({
    data: { referenceNo: `CST-${TAG}-${n}`, companyId: company.id, source: "direct" },
  });
  f.companies.push(company.id);
  f.customers.push(customer.id);
  return customer;
};
const makeVendor = async (n, type) => {
  const v = await prisma.vendor.create({
    data: { referenceNo: `VEN-${TAG}-${n}`, name: `${TAG} Vendor ${n}`, normalizedName: `${TAG} vendor ${n}`.toLowerCase(), type, country: "PK" },
  });
  f.vendors.push(v.id);
  return v;
};
const makeQuotation = async (customer, n) => {
  const query = await prisma.query.create({
    data: {
      referenceNo: `QRY-${TAG}-${n}`, customerId: customer.id, raisedById: f.ops.id, raisedVia: "bdo", status: "quoted",
      customerName: `${TAG} Contact`, customerEmail: `${TAG}@example.test`, customerPhone: "0300-0000000",
      pickupAddress: "Faisalabad, Pakistan", destinationAddress: "Antwerp, Belgium", services: ["sea_freight"],
    },
  });
  const quotation = await prisma.quotation.create({
    data: {
      referenceNo: `QT-${TAG}-${n}`, queryId: query.id, status: "sent", services: ["sea_freight"], currency: "EUR",
      totalAmount: 42260, createdById: f.ops.id, sentById: f.ops.id, sentAt: new Date(),
      chargeLines: { create: [{ service: "sea_freight", description: "Ocean Freight", quantity: 1, unitPrice: 42260, amount: 42260, sortOrder: 0 }] },
    },
    include: { chargeLines: true, query: true },
  });
  f.queries.push(query.id);
  f.quotations.push(quotation.id);
  return quotation;
};
/** The pivot, as the portal customer's own click would run it. */
const pivot = async (quotation, customer) => {
  const { shipment } = await prisma.$transaction(
    (tx) => createShipmentFromApproval(tx, { quotation, query: quotation.query, customer, actorId: f.ops.id, approvalChannel: "customer_portal" }),
    { timeout: 20000 },
  );
  if (!shipment?.id) throw new Error("pivot returned no shipment");
  f.shipments.push(shipment.id);
  return shipment;
};
const stepsOf = (shipmentId) => prisma.otdStep.findMany({ where: { shipmentId }, orderBy: { canonicalNo: "asc" } });
const complete = async (shipment, step, dept) =>
  prisma.$transaction((tx) => completeStepTx(tx, { shipment, step, actorId: f.ops.id, actorDeptCode: dept }));

const teardown = async () => {
  for (const sid of f.shipments) {
    const steps = await prisma.otdStep.findMany({ where: { shipmentId: sid }, select: { id: true } });
    await prisma.otdStepAction.deleteMany({ where: { otdStepId: { in: steps.map((s) => s.id) } } });
    const docs = await prisma.document.findMany({ where: { ownerType: "shipment", ownerId: sid } });
    for (const d of docs) fs.promises.unlink(path.join(UPLOAD_ROOT, d.storageKey)).catch(() => {});
    await prisma.document.deleteMany({ where: { ownerType: "shipment", ownerId: sid } });
    await prisma.task.deleteMany({ where: { shipmentId: sid } });
    await prisma.chatChannelMember.deleteMany({ where: { channel: { shipmentId: sid } } });
    await prisma.chatChannel.deleteMany({ where: { shipmentId: sid } });
    await prisma.otdStep.deleteMany({ where: { shipmentId: sid } });
    await prisma.otcMilestone.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipmentParty.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipmentStatusHistory.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipmentTradeStageHistory.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipmentException.deleteMany({ where: { shipmentId: sid } });
    await prisma.financialInstrumentDrawdown.deleteMany({ where: { shipmentId: sid } });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { shipmentId: sid } } });
    await prisma.payment.deleteMany({ where: { invoice: { shipmentId: sid } } });
    await prisma.invoice.deleteMany({ where: { shipmentId: sid } });
    await prisma.outboxEvent.deleteMany({ where: { payload: { path: ["shipmentId"], equals: sid } } });
    await prisma.shipment.deleteMany({ where: { id: sid } });
  }
  for (const qid of f.quotations) {
    await prisma.approvalLink.deleteMany({ where: { quotationId: qid } });
    await prisma.quotationChargeLine.deleteMany({ where: { quotationId: qid } });
    await prisma.outboxEvent.deleteMany({ where: { payload: { path: ["quotationId"], equals: qid } } });
  }
  await prisma.quotation.deleteMany({ where: { id: { in: f.quotations } } });
  await prisma.query.deleteMany({ where: { id: { in: f.queries } } });
  await prisma.financialInstrument.deleteMany({ where: { id: { in: f.fis } } });
  await prisma.tradeContract.deleteMany({ where: { id: { in: f.contracts } } });
  await prisma.shipmentParty.deleteMany({ where: { OR: [{ vendorId: { in: f.vendors } }, { customerId: { in: f.customers } }] } });
  await prisma.customer.deleteMany({ where: { id: { in: f.customers } } });
  await prisma.company.deleteMany({ where: { id: { in: f.companies } } });
  await prisma.vendor.deleteMany({ where: { id: { in: f.vendors } } });
  await prisma.auditLog.deleteMany({ where: { resourceId: { in: [...f.shipments, ...f.quotations, ...f.contracts, ...f.fis] } } });
  const noisy = await prisma.notification.findMany({ where: { OR: [{ title: { contains: TAG } }, ...f.refs.map((r) => ({ title: { contains: r } }))] }, select: { id: true } });
  await prisma.notificationDelivery.deleteMany({ where: { notificationId: { in: noisy.map((n) => n.id) } } });
  await prisma.notification.deleteMany({ where: { id: { in: noisy.map((n) => n.id) } } });
  // The throwaway admin step, if the run died before deleting it.
  await prisma.taskTemplate.deleteMany({ where: { eventCode: "otd.step", stepCode: f.adminStep } });
  await prisma.otdStepTemplate.deleteMany({ where: { stepCode: f.adminStep } });
};
f.refs = [];
f.adminStep = `zz_${TAG.toLowerCase()}_record`;

async function run() {
  f.ops = await prisma.user.findFirst({ where: { email: "ops.exec@consort.test" } });
  if (!f.ops) throw new Error("Seeded accounts missing — run `node prisma/seed.js --accounts-only`");
  const ops = await login("ops.exec@consort.test");
  const ceo = await login("ceo@consort.test");
  // Finance owns Step 1 (RULE-SH-04), so the tick test has to come from a finance user.
  const accounts = await login("accounts@consort.test");

  /* ── 1. The catalog ───────────────────────────────────────────────────── */
  console.log("\nCatalog (ADR-057)");
  const templates = await prisma.otdStepTemplate.findMany();
  const fwd = composeOtdPath(templates, "forwarding").map((s) => s.stepCode);
  const trd = composeOtdPath(templates, "trade").map((s) => s.stepCode);
  check("forwarding = Order Lock + the eight roadmap steps, in order", JSON.stringify(fwd) === JSON.stringify(FORWARDING_PATH), fwd.join(" → "));
  check("trade = the eight roadmap steps", JSON.stringify(trd) === JSON.stringify(ROADMAP), trd.join(" → "));
  const retired = templates.filter((t) => !FORWARDING_PATH.includes(t.stepCode));
  check("every other step is inactive (history only)", retired.every((t) => t.active === false), retired.filter((t) => t.active).map((t) => t.stepCode).join(", "));
  const activeTasks = await prisma.taskTemplate.findMany({ where: { eventCode: "otd.step", isActive: true }, select: { stepCode: true } });
  const activeTaskCodes = new Set(activeTasks.map((t) => t.stepCode));
  check("every live step has an active task template", FORWARDING_PATH.every((c) => activeTaskCodes.has(c)), [...FORWARDING_PATH].filter((c) => !activeTaskCodes.has(c)).join(", "));
  check("no retired step has one", retired.every((t) => !activeTaskCodes.has(t.stepCode)), retired.filter((t) => activeTaskCodes.has(t.stepCode)).map((t) => t.stepCode).join(", "));
  const liveCodes = new Set(templates.filter((t) => t.active).map((t) => t.stepCode));
  const charges = await prisma.chargeType.findMany({ where: { isActive: true, defaultStepCode: { not: null } } });
  const badCharges = charges.filter((c) => !liveCodes.has(c.defaultStepCode));
  check("every charge type lands on a live step", badCharges.length === 0, badCharges.map((c) => `${c.code}→${c.defaultStepCode}`).join(", "));
  const step1 = await prisma.otdStepActionTemplate.findMany({ where: { stepCode: "trade_contract_registered" } });
  check("Step 1 carries the two register items, required", step1.filter((a) => a.kind === "record" && a.required).map((a) => a.recordType).sort().join(",") === "contract,financial_instrument", JSON.stringify(step1.map((a) => [a.actionCode, a.kind, a.required])));
  let dupes = 0;
  let missing = 0;
  for (const p of ROADMAP_PARTIES) {
    const n = await prisma.vendor.count({ where: { normalizedName: normalizeVendorName(p.name) } });
    if (n === 0) missing++;
    if (n > 1) dupes++;
  }
  check(`the ${ROADMAP_PARTIES.length} roadmap parties exist exactly once`, missing === 0 && dupes === 0, `${missing} missing, ${dupes} duplicated`);

  /* ── 2. A quotation-born shipment ─────────────────────────────────────── */
  console.log("\nQuotation-born shipment");
  const c1 = await makeCustomer(1);
  const c2 = await makeCustomer(2);
  const v1 = await makeVendor(1, "exporter");
  const v2 = await makeVendor(2, "exporter");
  const bank = await makeVendor("B", "bank");
  const k1 = await prisma.tradeContract.create({ data: { referenceNo: `TCN-${TAG}-1`, contractNo: `AST/${TAG}/1`, direction: "export", vendorId: v1.id, customerId: c1.id, incoterm: "CFR", currency: "EUR" } });
  const k2 = await prisma.tradeContract.create({ data: { referenceNo: `TCN-${TAG}-2`, contractNo: `AST/${TAG}/2`, direction: "export", vendorId: v1.id, customerId: c2.id, incoterm: "CFR", currency: "EUR" } });
  f.contracts.push(k1.id, k2.id);
  const fi = (n, vendorId, extra = {}) =>
    prisma.financialInstrument.create({
      data: { referenceNo: `FI-${TAG}-${n}`, fiNumber: `BIP-EXP-${TAG}-${n}`, type: "exp_form", vendorId, bankVendorId: bank.id, currency: "EUR", value: 42260, cadPercent: 60, daPercent: 40, daDays: 75, portOfDischarge: "Antwerpen", expiryDate: new Date(Date.now() + 90 * DAY), status: "active", ...extra },
    });
  const f1 = await fi(1, v1.id, { customerId: c1.id, contractId: k1.id });
  const f2 = await fi(2, v2.id);
  const f3 = await fi(3, v1.id, { status: "expired", expiryDate: new Date(Date.now() - DAY) });
  f.fis.push(f1.id, f2.id, f3.id);

  const qt1 = await makeQuotation(c1, 1);
  const s1 = await pivot(qt1, c1);
  f.refs.push(s1.referenceNo);
  let steps1 = await stepsOf(s1.id);
  check("composes Order Lock + the eight", JSON.stringify(steps1.map((s) => s.stepCode)) === JSON.stringify(FORWARDING_PATH), steps1.map((s) => s.stepCode).join(" → "));
  check("direction defaults to export", s1.direction === "export", `${s1.direction}`);
  const byCode = Object.fromEntries(steps1.map((s) => [s.stepCode, s]));
  const docs1 = await prisma.document.findMany({ where: { ownerType: "shipment", ownerId: s1.id } });
  check("the quotation PDF hangs on Step 1", docs1.find((d) => d.docType === "quotation")?.otdStepId === byCode.trade_contract_registered?.id, JSON.stringify(docs1.map((d) => [d.docType, d.otdStepId === byCode.trade_contract_registered?.id])));
  check("the Rate Confirmation hangs on Order Lock", docs1.find((d) => d.docType === "rate_confirmation")?.otdStepId === byCode.order_lock?.id);
  check("the customer is a party from birth", !!(await prisma.shipmentParty.findFirst({ where: { shipmentId: s1.id, role: "customer", customerId: c1.id } })));

  /* ── 3. Step 1 is gated on the registers ──────────────────────────────── */
  console.log("\nStep 1 — the registers");
  // Order Lock is a hard gate in front; it is the RC test's job, so it is marked done
  // directly here to reach Step 1.
  await prisma.otdStep.update({ where: { id: byCode.order_lock.id }, data: { status: "done", completedAt: new Date() } });
  let refused = null;
  try {
    await complete(s1, byCode.trade_contract_registered, "finance");
  } catch (e) {
    refused = e;
  }
  check("refuses while nothing is linked — 422", refused?.statusCode === 422, `${refused?.statusCode} ${refused?.message}`);
  check("…naming the registers", /registers not linked: Trade Contract, Financial Instrument/.test(refused?.message ?? ""), refused?.message);

  await api("POST", `/shipments/${s1.id}/claim`, { token: ops.token });
  const link = (body) => api("PATCH", `/shipments/${s1.id}/trade-links`, { token: ops.token, body });
  check("another customer's contract — 422", (await link({ contractId: k2.id })).status === 422);
  check("another vendor's instrument — 422", (await link({ contractId: k1.id, financialInstrumentId: f2.id })).status === 422);
  check("an expired instrument — 409", (await link({ contractId: k1.id, financialInstrumentId: f3.id })).status === 409);
  check("nothing to link — 400", (await link({})).status === 400);
  const ok = await link({ contractId: k1.id, financialInstrumentId: f1.id });
  check("contract + active instrument — 200", ok.status === 200, `${ok.status} ${ok.body?.message}`);
  const s1b = await prisma.shipment.findUnique({ where: { id: s1.id } });
  check("both registers are on the shipment", s1b.contractId === k1.id && s1b.financialInstrumentId === f1.id);
  check("incoterm and destination came from the instrument", s1b.incoterm === "CFR" && s1b.destinationPort === "Antwerpen", `${s1b.incoterm} / ${s1b.destinationPort}`);
  check("trade stage derives to fi_active", s1b.tradeStage === "fi_active", s1b.tradeStage);
  const parties = await prisma.shipmentParty.findMany({ where: { shipmentId: s1.id }, select: { role: true } });
  check("vendor and bank parties were seeded", ["vendor", "bank"].every((r) => parties.some((p) => p.role === r)), parties.map((p) => p.role).join(", "));

  const detail = await api("GET", `/shipments/${s1.id}`, { token: ops.token });
  const s1step = (detail.body?.data?.otdSteps ?? []).find((s) => s.stepCode === "trade_contract_registered");
  const recordItems = (s1step?.actions ?? []).filter((a) => a.kind === "record");
  check("the checklist shows both register items satisfied, naming the rows", recordItems.length === 2 && recordItems.every((a) => a.satisfied && a.recordRef), JSON.stringify(recordItems.map((a) => [a.recordType, a.satisfied, a.recordRef])));

  refused = null;
  try {
    await complete(s1b, byCode.trade_contract_registered, "finance");
  } catch (e) {
    refused = e;
  }
  check("still refuses on the open manual item, no longer on the registers", refused?.statusCode === 422 && /checklist items still open/.test(refused.message) && !/registers not linked/.test(refused.message), refused?.message);
  await prisma.otdStepAction.updateMany({ where: { otdStepId: byCode.trade_contract_registered.id, kind: "manual" }, data: { status: "done", completedAt: new Date() } });
  const tick = await api("PATCH", `/otd/${s1.id}/steps/${byCode.trade_contract_registered.displayNo}/actions/contract_linked`, { token: accounts.token, body: { done: true } });
  check("a register item cannot be ticked by hand — 409", tick.status === 409, `${tick.status} ${tick.body?.message}`);
  let status = null;
  try {
    status = await complete(s1b, byCode.trade_contract_registered, "finance");
  } catch (e) {
    refused = e;
  }
  check("Step 1 completes once both registers are linked", status === "lc_generated", `${status ?? refused?.message}`);

  /* ── 4. Recompose ─────────────────────────────────────────────────────── */
  console.log("\nRecompose an untouched shipment");
  const qt2 = await makeQuotation(c1, 2);
  const s2 = await pivot(qt2, c1);
  f.refs.push(s2.referenceNo);
  // Put it back on the retired path by hand, as a pre-ADR-057 shipment would be.
  const old2 = await stepsOf(s2.id);
  await prisma.document.updateMany({ where: { ownerType: "shipment", ownerId: s2.id }, data: { otdStepId: null } });
  await prisma.otdStepAction.deleteMany({ where: { otdStepId: { in: old2.map((s) => s.id) } } });
  await prisma.otdStep.deleteMany({ where: { shipmentId: s2.id } });
  await prisma.otdStep.createMany({
    data: [
      { shipmentId: s2.id, canonicalNo: 10, displayNo: 1, stepCode: "order_lock", ownerDepartment: "operations" },
      { shipmentId: s2.id, canonicalNo: 20, displayNo: 2, stepCode: "order_confirmed", ownerDepartment: "operations" },
      { shipmentId: s2.id, canonicalNo: 170, displayNo: 3, stepCode: "delivered", ownerDepartment: "operations" },
    ],
  });
  await prisma.otdStep.updateMany({ where: { shipmentId: s2.id, stepCode: "order_lock" }, data: { status: "done" } });
  let r = await recomposeUntouched({ apply: true, only: [s2.id], log: () => {} });
  check("a shipment with a step done is left frozen", r.skipped === 1 && r.done === 0 && (await stepsOf(s2.id)).length === 3, JSON.stringify(r));
  await prisma.otdStep.updateMany({ where: { shipmentId: s2.id, stepCode: "order_lock" }, data: { status: "pending" } });
  r = await recomposeUntouched({ apply: true, only: [s2.id], log: () => {} });
  const new2 = await stepsOf(s2.id);
  check("an untouched one is recomposed onto the roadmap path", r.done === 1 && JSON.stringify(new2.map((s) => s.stepCode)) === JSON.stringify(FORWARDING_PATH), new2.map((s) => s.stepCode).join(" → "));
  const docs2 = await prisma.document.findMany({ where: { ownerType: "shipment", ownerId: s2.id } });
  const by2 = Object.fromEntries(new2.map((s) => [s.stepCode, s.id]));
  check("its documents were re-hung on the new steps", docs2.find((d) => d.docType === "quotation")?.otdStepId === by2.trade_contract_registered && docs2.find((d) => d.docType === "rate_confirmation")?.otdStepId === by2.order_lock);
  check("its checklists exist", (await prisma.otdStepAction.count({ where: { otdStepId: { in: new2.map((s) => s.id) } } })) > 0);
  r = await recomposeUntouched({ apply: true, only: [s2.id], log: () => {} });
  check("re-running touches nothing", r.done === 0 && r.skipped === 0, JSON.stringify(r));

  console.log("\nLocked shipments");
  await api("POST", `/shipments/${s2.id}/claim`, { token: ops.token });
  await api("POST", `/shipments/${s2.id}/cancel`, { token: ops.token, body: { reason: "verify: lock test" } });
  const onCancelled = await api("PATCH", `/shipments/${s2.id}/trade-links`, { token: ops.token, body: { contractId: k1.id } });
  check("linking on a cancelled shipment — 409", onCancelled.status === 409, `${onCancelled.status}`);
  // Same customer, same contract, the instrument s1 already carries.
  const qt3 = await makeQuotation(c1, 3);
  const s3 = await pivot(qt3, c1);
  f.refs.push(s3.referenceNo);
  await api("POST", `/shipments/${s3.id}/claim`, { token: ops.token });
  const taken = await api("PATCH", `/shipments/${s3.id}/trade-links`, { token: ops.token, body: { contractId: k1.id, financialInstrumentId: f1.id } });
  check("an instrument already backing another shipment — 409", taken.status === 409, `${taken.status} ${taken.body?.message}`);

  /* ── 5. Workflow admin ────────────────────────────────────────────────── */
  console.log("\nWorkflow admin");
  const made = await api("POST", "/workflow/steps", {
    token: ceo.token,
    body: { stepCode: f.adminStep, canonicalNo: 9990, title: `${TAG} record step`, ownerDepartment: "finance", derivedStatus: "booking", dueOffsetHours: 24, requiredDocTypes: [], appliesToKinds: ["trade"], active: false },
  });
  check("a throwaway step is created — 201", made.status === 201, `${made.status} ${JSON.stringify(made.body).slice(0, 160)}`);
  const bad = await api("PUT", `/workflow/steps/${f.adminStep}/actions`, { token: ceo.token, body: { actions: [{ actionCode: "contract_linked", title: "Contract linked", kind: "record", sortOrder: 10 }] } });
  check("a record item without a register — 400", bad.status === 400 && /recordType/.test(JSON.stringify(bad.body)), `${bad.status} ${JSON.stringify(bad.body).slice(0, 200)}`);
  const good = await api("PUT", `/workflow/steps/${f.adminStep}/actions`, { token: ceo.token, body: { actions: [{ actionCode: "contract_linked", title: "Contract linked", kind: "record", recordType: "contract", sortOrder: 10 }] } });
  check("with one — 200, recordType stored", good.status === 200 && good.body?.data?.[0]?.recordType === "contract", `${good.status} ${JSON.stringify(good.body).slice(0, 200)}`);
  const gone = await api("DELETE", `/workflow/steps/${f.adminStep}`, { token: ceo.token });
  check("the throwaway step is deleted — 200", gone.status === 200, `${gone.status}`);
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
      console.error(`Teardown failed — check for leftover ${TAG} rows:`, e.message);
    }
    console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
    if (failures.length) console.log(`  failed: ${failures.join(" · ")}`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });
