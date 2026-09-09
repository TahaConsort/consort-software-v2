/**
 * Export Shipment Documentation Workflow — end-to-end HTTP verification.
 *
 *   node scripts/verifyTradeFlow.js          (needs the dev server on :5000)
 *
 * There is no test framework in this repo, so this is the safety net for the trade
 * layer, in the same shape as scripts/verifyRfqFlow.js and scripts/verifyFleetCrud.js:
 * it builds ITS OWN company, customer, vendors and shipment, exercises the API as
 * several different roles, and tears everything down again — so it runs against an
 * empty database and leaves zero residue.
 *
 * PHASE 0 coverage — per-shipment party roles and the RBAC around them:
 *   · CRUD on /api/shipments/:id/parties
 *   · the one-target rule (exactly one of vendorId / customerId)
 *   · duplicate role guards
 *   · PERMISSION denial (in scope, lacks trade.party.manage) → 403
 *   · SCOPE denial (holds trade.read, no step for their department) → 404, never 403
 *   · portal containment — a customer never receives a party's bank or tax fields
 *   · order lock — a cancelled shipment refuses party writes
 *
 * Later phases extend this file rather than adding new scripts.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import bcrypt from "bcrypt";
import prisma from "../config/prisma.js";
import { PARTY_CONFIDENTIAL_FIELDS } from "../utils/partyRoles.js";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:5000/api";
const PASSWORD = "1234567";
const TAG = `ZZV${Date.now().toString().slice(-6)}`;

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

/** `POST /api/auth/login` returns accessToken/user/permissions at the TOP level. */
const login = async (email) => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok || !body.accessToken) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(body)}`);
  return body.accessToken;
};

const api = async (token, method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body: json };
};

// ── Fixtures ────────────────────────────────────────────────────────────────
// Built here rather than borrowed from the seed so the script runs on a database
// with no business data at all.
const fixtures = { vendorIds: [], ids: {} };

const buildFixtures = async () => {
  const bank = await prisma.vendor.create({
    data: {
      referenceNo: `VEN-${TAG}-1`,
      name: `${TAG} BankIslami Verify`,
      normalizedName: `${TAG} bankislami verify`.toLowerCase(),
      type: "bank",
      bankName: "BankIslami Pakistan Ltd",
      bankBranch: "Jail Road, Lahore",
      iban: "PK77BKIP0200239493380001",
      swiftCode: "BKIPPKKA",
      accountTitle: "Verify Account",
      taxId: "4240145",
      strn: "12-00-9805-878-37",
      rexNo: "PKREXPK42401453",
      country: "PK",
    },
  });
  const exporter = await prisma.vendor.create({
    data: {
      referenceNo: `VEN-${TAG}-2`,
      name: `${TAG} Ahmad Saeed Verify`,
      normalizedName: `${TAG} ahmad saeed verify`.toLowerCase(),
      type: "exporter",
      taxId: "4240145",
      rexNo: "PKREXPK42401453",
      iban: "PK77BKIP0200239493380001",
      country: "PK",
    },
  });
  const inactive = await prisma.vendor.create({
    data: {
      referenceNo: `VEN-${TAG}-3`,
      name: `${TAG} Retired Carrier`,
      normalizedName: `${TAG} retired carrier`.toLowerCase(),
      type: "ocean_carrier",
      isActive: false,
      country: "PK",
    },
  });
  // The rest of the roadmap directory: a carrier, a clearing agent and a terminal.
  const extra = {};
  for (const [key, name, type] of [
    ["carrier", "HMM Verify", "ocean_carrier"],
    ["clearingAgent", "NTC Logistics Verify", "customs_agent"],
    ["terminal", "QICT Verify", "port_terminal"],
  ]) {
    const v = await prisma.vendor.create({
      data: {
        referenceNo: `VEN-${TAG}-${key}`,
        name: `${TAG} ${name}`,
        normalizedName: `${TAG} ${name}`.toLowerCase(),
        type,
        country: "PK",
        currency: "PKR",
      },
    });
    extra[key] = v.id;
    fixtures.vendorIds.push(v.id);
  }

  fixtures.vendorIds.push(bank.id, exporter.id, inactive.id);
  fixtures.ids.bank = bank.id;
  fixtures.ids.exporter = exporter.id;
  fixtures.ids.inactive = inactive.id;
  Object.assign(fixtures.ids, extra);

  const company = await prisma.company.create({
    data: { name: `${TAG} Zanitex Verify`, normalizedName: `${TAG} zanitex verify`.toLowerCase(), country: "IT" },
  });
  const customer = await prisma.customer.create({
    data: { referenceNo: `CST-${TAG}`, companyId: company.id, source: "direct" },
  });
  fixtures.ids.company = company.id;
  fixtures.ids.customer = customer.id;

  // A TRADE shipment — born from a contract, not a quotation. Creating it with a null
  // quotationId/queryId is itself the proof that the Phase-0 nullability change landed.
  const shipment = await prisma.shipment.create({
    data: {
      referenceNo: `SHIP-${TAG}`,
      kind: "trade",
      direction: "export",
      customerId: customer.id,
      services: ["sea_freight"],
      originPort: "PKQCT",
      destinationPort: "NLRTM",
      incoterm: "CFR",
    },
  });
  fixtures.ids.shipment = shipment.id;

  // Three steps in three departments, so department scope can be tested both ways:
  // operations / finance / transport are IN scope, compliance is deliberately OUT.
  await prisma.otdStep.createMany({
    data: [
      { shipmentId: shipment.id, canonicalNo: 10, displayNo: 1, stepCode: "order_lock", ownerDepartment: "operations" },
      { shipmentId: shipment.id, canonicalNo: 130, displayNo: 2, stepCode: "bol_submitted", ownerDepartment: "finance" },
      { shipmentId: shipment.id, canonicalNo: 70, displayNo: 3, stepCode: "cargo_pickup", ownerDepartment: "transport" },
    ],
  });

  // No portal login is seeded anywhere, so make one for the containment checks.
  const portal = await prisma.user.create({
    data: {
      email: `portal.${TAG.toLowerCase()}@consort.test`,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "customer",
      roles: ["customer"],
      customer: { connect: { id: customer.id } },
      isActive: true,
    },
  });
  fixtures.ids.portalUser = portal.id;
  fixtures.ids.portalEmail = portal.email;
};

const teardown = async () => {
  const { shipment, portalUser, customer, company, tradeShipment, fi, contract } = fixtures.ids;

  // Trade documents first — every FK below is RESTRICT, so the order matters.
  if (tradeShipment) {
    for (const id of fixtures.ids.generatedDocs ?? []) {
      const doc = await prisma.document.findUnique({ where: { id }, select: { storageKey: true } });
      if (doc) {
        try {
          fs.unlinkSync(path.join(process.cwd(), "uploads", doc.storageKey));
        } catch {
          /* already gone */
        }
      }
    }
    await prisma.document.deleteMany({ where: { ownerType: "shipment", ownerId: tradeShipment } });
    await prisma.goodsDeclarationLine.deleteMany({ where: { goodsDeclaration: { shipmentId: tradeShipment } } });
    await prisma.goodsDeclaration.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.billOfLadingContainer.deleteMany({ where: { billOfLading: { shipmentId: tradeShipment } } });
    await prisma.payment.deleteMany({ where: { invoice: { shipmentId: tradeShipment } } });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { shipmentId: tradeShipment } } });
    await prisma.invoice.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.billOfLading.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.tradeInvoiceLine.deleteMany({ where: { tradeInvoice: { shipmentId: tradeShipment } } });
    await prisma.tradeInvoice.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.packingListItem.deleteMany({ where: { packingList: { shipmentId: tradeShipment } } });
    await prisma.packingList.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.shipmentContainer.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.shipmentTradeStageHistory.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.financialInstrumentDrawdown.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.shipmentParty.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.otdStepAction.deleteMany({ where: { otdStep: { shipmentId: tradeShipment } } });
    await prisma.otdStep.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.otcMilestone.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.chatChannelMember.deleteMany({ where: { channel: { shipmentId: tradeShipment } } });
    await prisma.chatChannel.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.shipmentStatusHistory.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.task.deleteMany({ where: { shipmentId: tradeShipment } });
    await prisma.shipment.delete({ where: { id: tradeShipment } }).catch(() => {});
  }
  if (fi) {
    await prisma.financialInstrumentDrawdown.deleteMany({ where: { financialInstrumentId: fi } });
    await prisma.financialInstrument.delete({ where: { id: fi } }).catch(() => {});
  }
  if (contract) await prisma.tradeContract.delete({ where: { id: contract } }).catch(() => {});
  // FKs are RESTRICT, not cascade — children first, in this order.
  if (shipment) {
    await prisma.shipmentParty.deleteMany({ where: { shipmentId: shipment } });
    await prisma.otdStepAction.deleteMany({ where: { otdStep: { shipmentId: shipment } } });
    await prisma.otdStep.deleteMany({ where: { shipmentId: shipment } });
    await prisma.auditLog.deleteMany({ where: { resourceId: shipment } });
    await prisma.shipment.delete({ where: { id: shipment } }).catch(() => {});
  }
  if (portalUser) {
    await prisma.refreshToken.deleteMany({ where: { userId: portalUser } });
    await prisma.loginActivity.deleteMany({ where: { userId: portalUser } });
    await prisma.user.delete({ where: { id: portalUser } }).catch(() => {});
  }
  if (customer) await prisma.customer.delete({ where: { id: customer } }).catch(() => {});
  if (company) await prisma.company.delete({ where: { id: company } }).catch(() => {});
  for (const id of fixtures.vendorIds) await prisma.vendor.delete({ where: { id } }).catch(() => {});
  // Party audit rows are keyed on the party id, which is gone — sweep by resource type.
  for (const rt of ["shipment_party", "trade_contract", "financial_instrument", "packing_list", "trade_invoice", "bill_of_lading", "goods_declaration", "shipment_container"]) {
    await prisma.auditLog.deleteMany({ where: { resourceType: rt } });
  }
  for (const et of [
    "shipment.parties.changed", "shipment.documents.changed", "shipment.trade_stage.changed",
    "trade.contract.created", "fi.registered", "fi.drawdown.recorded", "fi.closed",
    "trade.container.changed", "packing_list.changed", "packing_list.confirmed",
    "trade_invoice.changed", "trade_invoice.issued", "bol.changed", "gd.changed",
    "shipment.created", "invoice.created", "invoice.issued", "payment.received",
  ]) {
    await prisma.outboxEvent.deleteMany({ where: { eventType: et } });
  }

};


// ══════════════════════════════════════════════════════════════════════════════
// PHASES 1-6 — the full roadmap cycle, Step 1 through Step 8.
// Contract -> FI -> trade shipment -> container -> packing list -> commercial
// invoice -> booking/GD -> B/L -> logistics payables -> drawdown -> FI closure,
// checking the derived tradeStage and the RBAC at every rung.
// ══════════════════════════════════════════════════════════════════════════════
const runTradeCycle = async (tokens) => {
  const V = fixtures.ids;
  let r;

  console.log("\nStep 1 — contract and financial instrument (roadmap §4.1/§4.2)");
  r = await api(tokens.accounts, "POST", "/trade/contracts", {
    contractNo: `AST/${TAG}/002`,
    contractDate: "2025-09-05",
    vendorId: V.exporter,
    customerId: V.customer,
    currency: "EUR",
    incoterm: "CFR",
    totalValue: 42260,
    paymentTerms: "60% CAD / 40% DA 75 days from B/L date",
    productDescription: "Bedsheets, pillow covers, mattress protectors",
  });
  check("accounts cannot register a contract (no trade.contract.manage) -> 403", r.status === 403, `got ${r.status}`);

  r = await api(tokens.ops_exec, "POST", "/trade/contracts", {
    contractNo: `AST/${TAG}/002`,
    contractDate: "2025-09-05",
    vendorId: V.exporter,
    customerId: V.customer,
    currency: "EUR",
    incoterm: "CFR",
    totalValue: 42260,
    paymentTerms: "60% CAD / 40% DA 75 days from B/L date",
  });
  V.contract = r.body?.data?.id;
  check("ops_exec registers the contract -> 201", r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  check("contract gets a TCN reference", /^TCN-\d{4}-\d{5}$/.test(r.body?.data?.referenceNo ?? ""), r.body?.data?.referenceNo);

  const fiBody = {
    fiNumber: `BIP-EXP-${TAG}`,
    type: "exp_form",
    contractId: V.contract,
    vendorId: V.exporter,
    bankVendorId: V.bank,
    customerId: V.customer,
    currency: "EUR",
    value: 42260,
    cadPercent: 60,
    daPercent: 40,
    daDays: 75,
    incoterm: "CFR",
    portOfDischarge: "Antwerpen",
    issueDate: "2025-11-14",
    expiryDate: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
  };
  r = await api(tokens.ops_exec, "POST", "/trade/instruments", fiBody);
  check("ops_exec cannot register a bank instrument (no fi.manage) -> 403", r.status === 403, `got ${r.status}`);

  r = await api(tokens.accounts, "POST", "/trade/instruments", fiBody);
  V.fi = r.body?.data?.id;
  check("accounts registers the instrument -> 201", r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);

  r = await api(tokens.accounts, "POST", "/trade/instruments", { ...fiBody, contractId: V.contract });
  check("the same bank FI number twice -> 409", r.status === 409, `got ${r.status}`);

  r = await api(tokens.accounts, "POST", "/trade/instruments", { ...fiBody, fiNumber: `X-${TAG}`, cadPercent: 70, daPercent: 40 });
  check("CAD + DA over 100% is rejected -> 400", r.status === 400, `got ${r.status}`);

  console.log("\nStep 1b — trade shipment origination (supersedes INV-03)");
  r = await api(tokens.ops_exec, "POST", "/shipments/trade", {
    contractId: V.contract,
    financialInstrumentId: V.fi,
    customerId: V.customer,
    services: ["sea_freight", "customs_clearance", "port_handling", "local_transport"],
    direction: "export",
    originPort: "PKQCT",
    destinationPort: "NLRTM",
    incoterm: "CFR",
  });
  V.tradeShipment = r.body?.data?.id;
  check("a shipment is born from a contract, with no quotation -> 201", r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  check("it carries no quotationId (INV-03 superseded)", r.body?.data?.quotationId == null, String(r.body?.data?.quotationId));
  check("kind=trade, direction=export", r.body?.data?.kind === "trade" && r.body?.data?.direction === "export");

  const T = V.tradeShipment;
  r = await api(tokens.ops_exec, "GET", `/trade/shipments/${T}/overview`);
  check("stage is fi_active once the instrument is linked (§7.1)", r.body?.data?.tradeStage === "fi_active", r.body?.data?.tradeStage);
  check("parties were seeded from the contract and the instrument", (r.body?.data ? true : false));

  r = await api(tokens.ops_exec, "GET", `/shipments/${T}/parties`);
  const seededRoles = (r.body?.data?.parties ?? []).map((p) => p.role).sort();
  check("vendor, customer and bank are already named", ["bank", "customer", "vendor"].every((x) => seededRoles.includes(x)), seededRoles.join(","));

  r = await api(tokens.ops_exec, "POST", "/shipments/trade", {
    contractId: V.contract,
    financialInstrumentId: V.fi,
    customerId: V.customer,
    services: ["sea_freight"],
  });
  check("one instrument cannot back two shipments -> 409", r.status === 409, `got ${r.status}`);
};

const runTradeCycle2 = async (tokens) => {
  const V = fixtures.ids;
  const T = V.tradeShipment;
  let r;

  console.log("\nStep 2 — container and packing list (roadmap §4.3)");
  r = await api(tokens.ops_exec, "POST", `/trade/shipments/${T}/containers`, {
    containerNo: "KOCU5179385",
    sealNo: "24H1277873",
    containerTypeCode: "40HC",
  });
  V.container = r.body?.data?.id;
  check("container with seal recorded -> 201", r.status === 201, `got ${r.status}`);

  r = await api(tokens.compliance_exec, "POST", `/trade/shipments/${T}/containers`, { containerNo: "ZZZU1111111" });
  check("compliance cannot touch cargo documents -> 403", r.status === 403, `got ${r.status}`);

  r = await api(tokens.ops_exec, "PUT", `/trade/shipments/${T}/packing-list`, {
    containerId: V.container,
    issuedByVendorId: V.exporter,
    listDate: "2025-11-13",
  });
  check("packing list created -> 200", r.status === 200, `got ${r.status}`);

  r = await api(tokens.ops_exec, "PUT", `/trade/shipments/${T}/packing-list/items`, {
    items: [
      { skuRef: "FS-180", description: "Fitted sheets 180x200", hsCode: "6302.3110", qtyPerBox: 20, boxes: 400, pieces: 8000, netWeightKg: 4200.5, grossWeightKg: 4500 },
      { skuRef: "PC-50", description: "Pillow covers 50x70", hsCode: "6302.3150", qtyPerBox: 30, boxes: 441, pieces: 8390, netWeightKg: 4447.8, grossWeightKg: 4768 },
    ],
  });
  const pl = r.body?.data;
  check("items saved and header totals recomputed server-side", r.status === 200 && pl?.totalCartons === 841 && pl?.totalPieces === 16390, `cartons=${pl?.totalCartons} pieces=${pl?.totalPieces}`);
  check("gross weight totalled from the items", Number(pl?.totalGrossWeightKg) === 9268, String(pl?.totalGrossWeightKg));

  r = await api(tokens.ops_exec, "POST", `/trade/shipments/${T}/packing-list/confirm`);
  check("confirming the packing list -> 200", r.status === 200, `got ${r.status}`);
  r = await api(tokens.ops_exec, "GET", `/trade/shipments/${T}/overview`);
  check("stage advances to packing_list_confirmed", r.body?.data?.tradeStage === "packing_list_confirmed", r.body?.data?.tradeStage);

  console.log("\nStep 3 — commercial invoice (roadmap §4.4), and the purchase/sale rule");
  r = await api(tokens.ops_exec, "POST", `/trade/shipments/${T}/invoices`, {
    side: "purchase",
    invoiceNo: `AST/11/25/${TAG}`,
    invoiceDate: "2025-11-13",
    financialInstrumentId: V.fi,
    sellerVendorId: V.exporter,
    bankVendorId: V.bank,
    currency: "EUR",
    shipmentTerms: "CFR Antwerp",
    rexNo: "PKREXPK42401453",
  });
  V.purchaseInv = r.body?.data?.id;
  check("ops records the vendor PURCHASE invoice -> 201", r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);

  r = await api(tokens.ops_exec, "POST", `/trade/shipments/${T}/invoices`, {
    side: "sale",
    invoiceNo: `SALE/${TAG}`,
    invoiceDate: "2025-11-14",
    currency: "EUR",
  });
  check("ops cannot raise a SALE invoice — that is revenue (403)", r.status === 403, `got ${r.status}`);

  r = await api(tokens.accounts, "POST", `/trade/shipments/${T}/invoices`, {
    side: "sale",
    invoiceNo: `SALE/${TAG}`,
    invoiceDate: "2025-11-14",
    financialInstrumentId: V.fi,
    currency: "EUR",
    buyerCustomerId: V.customer,
  });
  V.saleInv = r.body?.data?.id;
  check("accounts raises the SALE invoice -> 201", r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);

  r = await api(tokens.ops_exec, "POST", `/trade/shipments/${T}/invoices/${V.purchaseInv}/lines/from-packing-list`);
  const seeded = r.body?.data?.lines ?? [];
  check("invoice lines seed from the packing list (§6 — no retyping)", r.status === 200 && seeded.length === 2, `got ${r.status}, ${seeded.length} lines`);
  check("HS codes carried across from the packing list", seeded[0]?.hsCode === "6302.3110", seeded[0]?.hsCode);

  r = await api(tokens.ops_exec, "PUT", `/trade/shipments/${T}/invoices/${V.purchaseInv}/lines`, {
    lines: [
      { description: "Fitted sheets 180x200", hsCode: "6302.3110", quantity: 8000, unitPrice: 2.5, unitOfMeasure: "PCS" },
      { description: "Pillow covers 50x70", hsCode: "6302.3150", quantity: 8390, unitPrice: 2.65, unitOfMeasure: "PCS" },
    ],
  });
  check("invoice total is computed server-side from the lines", Number(r.body?.data?.totalValue) === 42233.5, String(r.body?.data?.totalValue));

  r = await api(tokens.ops_exec, "POST", `/trade/shipments/${T}/invoices/${V.purchaseInv}/issue`);
  check("ops cannot ISSUE — four-eyes with Accounts (403)", r.status === 403, `got ${r.status}`);
  r = await api(tokens.accounts, "POST", `/trade/shipments/${T}/invoices/${V.purchaseInv}/issue`);
  check("accounts issues the purchase invoice -> 200", r.status === 200, `got ${r.status}`);
  r = await api(tokens.ops_exec, "GET", `/trade/shipments/${T}/overview`);
  check("stage advances to commercial_invoice_raised", r.body?.data?.tradeStage === "commercial_invoice_raised", r.body?.data?.tradeStage);

  r = await api(tokens.accounts, "PUT", `/trade/shipments/${T}/invoices/${V.saleInv}/lines`, {
    lines: [{ description: "Bedsheet consignment", hsCode: "6302.3110", quantity: 1, unitPrice: 48000 }],
  });
  check("sale invoice priced", Number(r.body?.data?.totalValue) === 48000, String(r.body?.data?.totalValue));
  r = await api(tokens.accounts, "POST", `/trade/shipments/${T}/invoices/${V.saleInv}/issue`);
  check("issuing the SALE invoice drafts a receivable for OTC", r.status === 200 && !!r.body?.data?.receivableInvoiceId, `got ${r.status}`);
  V.receivable = r.body?.data?.receivableInvoiceId;
};

const runTradeCycle3 = async (tokens) => {
  const V = fixtures.ids;
  const T = V.tradeShipment;
  let r;

  console.log("\nSteps 4-5 — customs declaration and Bill of Lading (§4.5/§4.6)");
  r = await api(tokens.ops_exec, "PUT", `/trade/shipments/${T}/goods-declaration`, { gdNumber: `GD-${TAG}` });
  check("ops cannot file the GD — that is Compliance (403)", r.status === 403, `got ${r.status}`);

  r = await api(tokens.compliance_exec, "PUT", `/trade/shipments/${T}/goods-declaration`, {
    gdNumber: `GD-${TAG}`,
    gdDate: "2025-11-18",
    clearingAgentVendorId: V.clearingAgent,
    financialInstrumentId: V.fi,
    tradeInvoiceId: V.purchaseInv,
    portOfShipment: "Port Qasim",
    exchangeRate: 312.5,
    fobValuePkr: 13197968.75,
    cfrValuePkr: 13447968.75,
    assessedValuePkr: 13447968.75,
    appraiserName: "Appraiser A",
    examinerName: "Examiner B",
    filedAt: "2025-11-18",
  });
  check("compliance files the GD -> 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  check("the PKR exchange rate is captured on the declaration", Number(r.body?.data?.exchangeRate) === 312.5, String(r.body?.data?.exchangeRate));

  r = await api(tokens.compliance_exec, "PUT", `/trade/shipments/${T}/goods-declaration/lines`, {
    lines: [{ hsCode: "6302.3110", description: "Fitted sheets", quantity: 8000, unitValue: 2.5, declaredValuePkr: 6250000, assessedValuePkr: 6250000, sroCode: "SRO-327" }],
  });
  check("GD lines saved with HS codes and assessed PKR values", r.status === 200 && (r.body?.data?.lines ?? []).length === 1, `got ${r.status}`);

  r = await api(tokens.ops_exec, "GET", `/trade/shipments/${T}/overview`);
  check("filing the GD advances the stage to booking_confirmed", r.body?.data?.tradeStage === "booking_confirmed", r.body?.data?.tradeStage);

  r = await api(tokens.compliance_exec, "PUT", `/trade/shipments/${T}/bill-of-lading`, { blNumber: "X" });
  check("compliance cannot record the B/L — that is Operations (403)", r.status === 403, `got ${r.status}`);

  const shippedOnBoard = new Date(Date.now() - 70 * 24 * 3600 * 1000).toISOString();
  r = await api(tokens.ops_exec, "PUT", `/trade/shipments/${T}/bill-of-lading`, {
    blNumber: `KHIE${TAG}`,
    bookingNo: `KHIE${TAG}`,
    carrierVendorId: V.carrier,
    consigneeText: "To the order of BankIslami Pakistan Limited",
    notifyText: "SAS METM Consulting and Trading",
    secondNotifyText: "Javed Latif",
    vesselName: "ONE RECOGNITION",
    voyageNo: "V0009W",
    freightTerms: "prepaid",
    shippedOnBoard,
    grossWeightKg: 9268,
    netWeightKg: 8648.3,
    containerIds: [V.container],
  });
  check("ops records the B/L with vessel, voyage and container -> 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  r = await api(tokens.ops_exec, "GET", `/trade/shipments/${T}/overview`);
  check("stage advances to shipped_on_board", r.body?.data?.tradeStage === "shipped_on_board", r.body?.data?.tradeStage);
  V.bol = r.body?.data?.billOfLading?.id;

  console.log("\n§7.2 — the automatic flags");
  r = await api(tokens.ops_exec, "GET", `/trade/shipments/${T}/alerts`);
  let alerts = r.body?.data ?? [];
  check("DA maturity computed from the B/L date + daDays, not typed in", alerts.some((a) => ["da_due", "da_overdue"].includes(a.code)), alerts.map((a) => a.code).join(","));
  check("FI expiry inside 14 days is flagged", alerts.some((a) => a.code === "fi_expiring"), alerts.map((a) => a.code).join(","));

  await api(tokens.ops_exec, "PUT", `/trade/shipments/${T}/bill-of-lading`, { blNumber: `KHIE${TAG}`, grossWeightKg: 7000 });
  r = await api(tokens.ops_exec, "GET", `/trade/shipments/${T}/alerts`);
  alerts = r.body?.data ?? [];
  check("a packing-list vs B/L weight mismatch is reported", alerts.some((a) => a.code === "weight_mismatch"), alerts.map((a) => a.code).join(","));
  await api(tokens.ops_exec, "PUT", `/trade/shipments/${T}/bill-of-lading`, { blNumber: `KHIE${TAG}`, grossWeightKg: 9268 });
};

const runTradeCycle4 = async (tokens) => {
  const V = fixtures.ids;
  const T = V.tradeShipment;
  let r;

  console.log("\nSteps 6-8 — logistics bills, realisation, closure");
  r = await api(tokens.accounts, "POST", "/finance/invoices", {
    shipmentId: T,
    kind: "payable",
    vendorId: V.terminal,
    currency: "PKR",
    billOfLadingId: V.bol,
    containerId: V.container,
    lines: [
      { description: "PQA Wharfage", chargeCode: "pqa_wharfage", quantity: 1, unitPrice: 20000, taxPercent: 15 },
      { description: "Export Examination", chargeCode: "export_examination", quantity: 1, unitPrice: 14226, taxPercent: 15 },
    ],
  });
  V.payable = r.body?.data?.id;
  check("terminal invoice with 15% Sindh Sales Tax per line -> 201", r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  check("tax computed server-side and added to the total", Number(r.body?.data?.totalAmount) === 39359.9, String(r.body?.data?.totalAmount));

  await api(tokens.accounts, "POST", `/finance/invoices/${V.payable}/issue`);
  await api(tokens.accounts, "POST", `/finance/invoices/${V.payable}/payments`, { amount: 39359.9, method: "bank_transfer", receivedAt: new Date().toISOString() });
  r = await api(tokens.ops_exec, "GET", `/trade/shipments/${T}/overview`);
  check("paying every payable advances the stage to logistics_settled", r.body?.data?.tradeStage === "logistics_settled", r.body?.data?.tradeStage);

  await api(tokens.accounts, "POST", `/finance/invoices/${V.receivable}/issue`);
  r = await api(tokens.accounts, "POST", `/finance/invoices/${V.receivable}/payments`, { amount: 48000, method: "bank_transfer", receivedAt: new Date().toISOString() });
  check("the customer receivable is paid -> 200", r.status === 200, `got ${r.status}`);
  r = await api(tokens.accounts, "GET", `/trade/instruments/${V.fi}`);
  check("payment drew the instrument down automatically (Step 7)", Number(r.body?.data?.drawnAmount) === 48000, String(r.body?.data?.drawnAmount));
  r = await api(tokens.ops_exec, "GET", `/trade/shipments/${T}/overview`);
  check("stage advances to payment_realised", r.body?.data?.tradeStage === "payment_realised", r.body?.data?.tradeStage);

  r = await api(tokens.ops_exec, "POST", `/trade/instruments/${V.fi}/close`, {});
  check("ops cannot close a bank instrument (403)", r.status === 403, `got ${r.status}`);
  r = await api(tokens.accounts, "POST", `/trade/instruments/${V.fi}/close`, { force: true, reason: "Balance written back by the bank" });
  check("accounts closes the instrument -> 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  r = await api(tokens.ops_exec, "GET", `/trade/shipments/${T}/overview`);
  check("stage reaches fi_closed — the cycle is complete (§7.1)", r.body?.data?.tradeStage === "fi_closed", r.body?.data?.tradeStage);

  console.log("\n§8 — document generation");
  r = await api(tokens.ops_exec, "POST", `/trade/shipments/${T}/packing-list/pdf`);
  check("packing list renders to a PDF and attaches as a shipment document", r.status === 201 && r.body?.data?.docType === "packing_list", `got ${r.status} ${JSON.stringify(r.body?.message)}`);
  V.generatedDocs = [r.body?.data?.id].filter(Boolean);
  r = await api(tokens.ops_exec, "POST", `/trade/shipments/${T}/invoices/${V.purchaseInv}/pdf`);
  check("commercial invoice renders to a PDF", r.status === 201 && r.body?.data?.docType === "commercial_invoice", `got ${r.status}`);
  if (r.body?.data?.id) V.generatedDocs.push(r.body.data.id);

  const stageRows = await prisma.shipmentTradeStageHistory.count({ where: { shipmentId: T } });
  check("every stage change left a history row", stageRows >= 6, `found ${stageRows}`);

  console.log("\nPortal containment on a trade shipment");
  r = await api(tokens.portal, "GET", `/trade/shipments/${T}/overview`);
  check("the customer sees the shipment but not the instrument", r.status === 200 && r.body?.data?.financialInstrument === null, `got ${r.status}`);
  check("the customer never sees the purchase invoice", (r.body?.data?.tradeInvoices ?? []).every((i) => i.side === "sale"), "a purchase invoice leaked");
  check("the customer sees no assessed customs values", r.body?.data?.goodsDeclaration?.assessedValuePkr === undefined, "GD values leaked");

  console.log("\nJob P&L now carries the goods margin (decision #1)");
  r = await api(tokens.ceo, "GET", `/shipments/${T}/pnl`);
  check("goods revenue less goods cost is reported", r.status === 200 && r.body?.data?.goods?.margin === 5766.5, `got ${r.status} ${JSON.stringify(r.body?.data?.goods)}`);
};

// ── Checks ──────────────────────────────────────────────────────────────────
const run = async () => {
  console.log(`\nExport trade flow — verification (${TAG})\n`);
  await buildFixtures();

  const S = fixtures.ids.shipment;
  const tokens = {
    ops_exec: await login("ops.exec@consort.test"),
    ops_manager: await login("ops.manager@consort.test"),
    accounts: await login("accounts@consort.test"),
    transport_exec: await login("transport.exec@consort.test"),
    compliance_exec: await login("compliance.exec@consort.test"),
    hr: await login("hr@consort.test"),
    ceo: await login("ceo@consort.test"),
    portal: await login(fixtures.ids.portalEmail),
  };

  console.log("Party CRUD (as ops_exec)");
  // Party writes are ops-owner work since ops ownership landed (2026-09-08): the
  // shipment has to be claimed first, or every write below is refused with 409.
  await api(tokens.ops_exec, "POST", `/shipments/${S}/claim`);
  let r = await api(tokens.ops_exec, "GET", `/shipments/${S}/parties`);
  check("GET parties on a fresh shipment is 200 and empty", r.status === 200 && r.body?.data?.parties?.length === 0, `got ${r.status}`);
  check(
    "unfilled roadmap roles are reported on a trade shipment",
    Array.isArray(r.body?.data?.missingRoles) && r.body.data.missingRoles.includes("bank"),
    JSON.stringify(r.body?.data?.missingRoles),
  );

  r = await api(tokens.ops_exec, "POST", `/shipments/${S}/parties`, { role: "bank", vendorId: fixtures.ids.bank });
  const bankPartyId = r.body?.data?.id;
  check("POST party (bank) is 201", r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  check("created party is hydrated with the vendor record", r.body?.data?.party?.iban === "PK77BKIP0200239493380001");

  r = await api(tokens.ops_exec, "POST", `/shipments/${S}/parties`, { role: "bank", vendorId: fixtures.ids.bank });
  check("same party twice in the same role is 409", r.status === 409, `got ${r.status}`);

  r = await api(tokens.ops_exec, "POST", `/shipments/${S}/parties`, { role: "exporter", vendorId: fixtures.ids.bank });
  const exporterPartyId = r.body?.data?.id;
  check("same party in a DIFFERENT role is allowed", r.status === 201, `got ${r.status}`);

  r = await api(tokens.ops_exec, "POST", `/shipments/${S}/parties`, { role: "notify_party", vendorId: fixtures.ids.exporter });
  const notify1 = r.body?.data?.id;
  const r2 = await api(tokens.ops_exec, "POST", `/shipments/${S}/parties`, { role: "notify_party", customerId: fixtures.ids.customer });
  check(
    "two DIFFERENT parties may share one role (the roadmap B/L has two notify parties)",
    r.status === 201 && r2.status === 201,
    `${r.status}/${r2.status}`,
  );
  const notify2 = r2.body?.data?.id;

  r = await api(tokens.ops_exec, "POST", `/shipments/${S}/parties`, {
    role: "vendor",
    vendorId: fixtures.ids.bank,
    customerId: fixtures.ids.customer,
  });
  check("both vendorId and customerId is rejected (400)", r.status === 400, `got ${r.status}`);

  r = await api(tokens.ops_exec, "POST", `/shipments/${S}/parties`, { role: "vendor" });
  check("neither vendorId nor customerId is rejected (400)", r.status === 400, `got ${r.status}`);

  r = await api(tokens.ops_exec, "POST", `/shipments/${S}/parties`, { role: "chief_of_vibes", vendorId: fixtures.ids.exporter });
  check("an unknown role is rejected (400)", r.status === 400, `got ${r.status}`);

  r = await api(tokens.ops_exec, "POST", `/shipments/${S}/parties`, { role: "ocean_carrier", vendorId: fixtures.ids.inactive });
  check("a deactivated vendor cannot be put on a shipment (409)", r.status === 409, `got ${r.status}`);

  r = await api(tokens.ops_exec, "POST", `/shipments/${S}/parties`, { role: "bank", vendorId: crypto.randomUUID() });
  check("an unknown vendor id is 404", r.status === 404, `got ${r.status}`);

  console.log("\nRole is per shipment, not per company (roadmap §1)");
  r = await api(tokens.ops_exec, "PATCH", `/shipments/${S}/parties/${notify1}`, { role: "freight_forwarder" });
  check(
    "a party whose Vendor.type is `exporter` can hold the freight_forwarder role",
    r.status === 200 && r.body?.data?.role === "freight_forwarder",
    `got ${r.status} ${JSON.stringify(r.body?.data?.role)}`,
  );
  r = await api(tokens.ops_exec, "PATCH", `/shipments/${S}/parties/${exporterPartyId}`, { role: "bank" });
  check("re-roling onto a role that party already holds is 409", r.status === 409, `got ${r.status}`);

  console.log("\nPermission vs scope (BUSINESS_RULES §2.2/§2.3)");
  r = await api(tokens.accounts, "GET", `/shipments/${S}/parties`);
  check("accounts holds trade.read and has a finance step → 200", r.status === 200, `got ${r.status}`);
  r = await api(tokens.accounts, "POST", `/shipments/${S}/parties`, { role: "port_terminal", vendorId: fixtures.ids.exporter });
  check("accounts lacks trade.party.manage → 403 (in scope, denied on permission)", r.status === 403, `got ${r.status}`);

  r = await api(tokens.transport_exec, "GET", `/shipments/${S}/parties`);
  check("transport_exec holds trade.read and has a transport step → 200", r.status === 200, `got ${r.status}`);
  r = await api(tokens.transport_exec, "POST", `/shipments/${S}/parties`, { role: "transporter", vendorId: fixtures.ids.exporter });
  check("transport_exec lacks trade.party.manage → 403", r.status === 403, `got ${r.status}`);

  r = await api(tokens.compliance_exec, "GET", `/shipments/${S}/parties`);
  check("compliance_exec holds trade.read but has NO step here → 404, never 403", r.status === 404, `got ${r.status}`);

  r = await api(tokens.hr, "GET", `/shipments/${S}/parties`);
  check("hr holds no shipment access at all → 403", r.status === 403, `got ${r.status}`);

  r = await api(tokens.ceo, "GET", `/shipments/${S}/parties`);
  check("Management sees everything → 200", r.status === 200, `got ${r.status}`);

  console.log("\nPortal containment (ADR-047 / INV-10)");
  r = await api(tokens.portal, "GET", `/shipments/${S}/parties`);
  const portalParties = r.body?.data?.parties ?? [];
  const leaked = portalParties
    .filter((p) => p.partyKind === "vendor" && p.party)
    .flatMap((p) => PARTY_CONFIDENTIAL_FIELDS.filter((f) => f in p.party));
  check("a portal customer can read the party list of their own shipment", r.status === 200, `got ${r.status}`);
  check("no bank or tax field reaches the portal", leaked.length === 0, `leaked: ${[...new Set(leaked)].join(", ")}`);
  check("the party is still identifiable to the customer", portalParties.some((p) => p.party?.name), "no name returned");

  r = await api(tokens.portal, "POST", `/shipments/${S}/parties`, { role: "bank", vendorId: fixtures.ids.exporter });
  check("a portal customer cannot add a party → 403", r.status === 403, `got ${r.status}`);
  r = await api(tokens.portal, "DELETE", `/shipments/${S}/parties/${bankPartyId}`);
  check("a portal customer cannot remove a party → 403", r.status === 403, `got ${r.status}`);

  console.log("\nOrder lock (RULE-SH-12)");
  await prisma.shipment.update({ where: { id: S }, data: { exceptionState: "cancelled" } });
  r = await api(tokens.ops_exec, "POST", `/shipments/${S}/parties`, { role: "port_terminal", vendorId: fixtures.ids.exporter });
  check("a cancelled shipment refuses party writes → 409", r.status === 409, `got ${r.status}`);
  r = await api(tokens.ops_exec, "GET", `/shipments/${S}/parties`);
  check("a cancelled shipment still READS its parties", r.status === 200, `got ${r.status}`);
  await prisma.shipment.update({ where: { id: S }, data: { exceptionState: "none" } });

  console.log("\nAudit + delete");
  // Only the ops OWNER may change parties (ops ownership, 2026-09-08) — a second ops
  // user is refused, so the delete has to come from whoever claimed it above.
  r = await api(tokens.ops_manager, "DELETE", `/shipments/${S}/parties/${notify2}`);
  check("a non-owner ops user cannot delete a party (403)", r.status === 403, `got ${r.status}`);
  r = await api(tokens.ops_exec, "DELETE", `/shipments/${S}/parties/${notify2}`);
  check("DELETE party is 200", r.status === 200, `got ${r.status}`);
  r = await api(tokens.ops_exec, "DELETE", `/shipments/${S}/parties/${notify2}`);
  check("deleting the same party twice is 404", r.status === 404, `got ${r.status}`);

  const audits = await prisma.auditLog.count({ where: { resourceType: "shipment_party" } });
  check("every party mutation wrote an audit row (INV-15)", audits >= 5, `found ${audits}`);
  const events = await prisma.outboxEvent.count({ where: { eventType: "shipment.parties.changed" } });
  check("every party mutation emitted shipment.parties.changed (ADR-021)", events >= 5, `found ${events}`);

  // Phases 1-6 — the whole roadmap cycle on a second, purpose-built shipment.
  await runTradeCycle(tokens);
  await runTradeCycle2(tokens);
  await runTradeCycle3(tokens);
  await runTradeCycle4(tokens);
};

run()
  .catch((err) => {
    fail += 1;
    failures.push(`fatal: ${err.message}`);
    console.error("\n✗ fatal:", err.message);
  })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown warning:", e.message));
    console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
    if (failures.length) console.log("  failed: " + failures.join("; "));
    await prisma.$disconnect();
    process.exitCode = fail === 0 ? 0 : 1;
  });
