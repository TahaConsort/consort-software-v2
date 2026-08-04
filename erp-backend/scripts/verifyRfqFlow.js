/**
 * End-to-end check of the vendor RFQ module against a RUNNING local server.
 * Leaves zero residue: everything it creates it deletes, in FK-safe order,
 * generated RC files included.
 *
 *   node scripts/verifyRfqFlow.js
 *   BASE=http://localhost:5000 EMAIL=ops.exec@consort.test PASSWORD=1234567 node scripts/verifyRfqFlow.js
 *
 * Runs as ops_exec deliberately — the role granted rfq.manage/rfq.award, so a
 * wrong permission map fails here first.
 *
 * Fixtures (customer, query, vendors) are created straight through Prisma rather
 * than over HTTP: ops_exec can raise neither a query (that is a BDO/portal act,
 * RULE-QRY-01) nor a vendor, and borrowing those roles would test the wrong thing.
 * The fixture query moves inland BY RAIL, so the per-leg flow is the main path;
 * the customs RFQ rides along as the leg-null (truck-style) regression.
 *
 * Exercises: login → per-leg batch create → leg coherence 400s → duplicate-open
 * 409s (leg and leg-null) → enter rates (server-computed totals, client totals
 * ignored) → decline/award guards → award all four → cost sheet with legs →
 * vendor RC generation (+ 409 on a losing bid) → handoff to POST /api/quotations
 * with costs carried → cancel rules.
 */
import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { UPLOAD_ROOT } from "../modules/document/document.service.js";

const BASE = process.env.BASE ?? "http://localhost:5000";
const EMAIL = process.env.EMAIL ?? "ops.exec@consort.test";
const PASSWORD = process.env.PASSWORD ?? "1234567";

const TAG = "ZZ Verify RFQ";
const VENDOR_NAMES = [
  `${TAG} Transporter A`,
  `${TAG} Transporter B`,
  `${TAG} Customs Agent`,
  `${TAG} Rail Operator`,
];

let token = null;
const call = async (method, p, body) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/**
 * Cleanup runs first and last. The FKs here are RESTRICT, not cascade, so the
 * order matters: quote lines → quotes → rfqs, and the quotation children before
 * the query that owns them. Vendor RC documents (and their files on disk) go
 * before the vendors they hang off.
 */
const cleanup = async () => {
  const queries = await prisma.query.findMany({
    where: { cargoDescription: TAG },
    select: { id: true },
  });
  const queryIds = queries.map((q) => q.id);

  const ownCompanies = await prisma.company.findMany({ where: { name: TAG }, select: { id: true } });
  const ownCompanyIds = ownCompanies.map((c) => c.id);

  const vendors = await prisma.vendor.findMany({ where: { name: { in: VENDOR_NAMES } }, select: { id: true } });
  const vendorIds = vendors.map((v) => v.id);

  if (vendorIds.length) {
    const docs = await prisma.document.findMany({
      where: { ownerType: "vendor", ownerId: { in: vendorIds } },
      select: { id: true, storageKey: true },
    });
    for (const d of docs) {
      try { fs.unlinkSync(path.join(UPLOAD_ROOT, d.storageKey)); } catch { /* already gone */ }
    }
    await prisma.auditLog.deleteMany({ where: { resourceType: "document", resourceId: { in: docs.map((d) => d.id) } } });
    await prisma.document.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } });
  }

  if (queryIds.length) {
    const rfqs = await prisma.vendorRfq.findMany({ where: { queryId: { in: queryIds } }, select: { id: true } });
    const rfqIds = rfqs.map((r) => r.id);
    if (rfqIds.length) {
      const quotes = await prisma.vendorQuote.findMany({ where: { rfqId: { in: rfqIds } }, select: { id: true } });
      await prisma.vendorQuoteLine.deleteMany({ where: { quoteId: { in: quotes.map((q) => q.id) } } });
      await prisma.vendorQuote.deleteMany({ where: { rfqId: { in: rfqIds } } });
      await prisma.vendorRfq.deleteMany({ where: { id: { in: rfqIds } } });
    }

    const quotations = await prisma.quotation.findMany({ where: { queryId: { in: queryIds } }, select: { id: true } });
    const quotationIds = quotations.map((q) => q.id);
    if (quotationIds.length) {
      await prisma.quotationChargeLine.deleteMany({ where: { quotationId: { in: quotationIds } } });
      await prisma.document.deleteMany({ where: { ownerType: "quotation", ownerId: { in: quotationIds } } });
      await prisma.quotation.deleteMany({ where: { id: { in: quotationIds } } });
    }
    await prisma.query.deleteMany({ where: { id: { in: queryIds } } });
  }

  if (ownCompanyIds.length) {
    await prisma.customer.deleteMany({ where: { companyId: { in: ownCompanyIds } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: ownCompanyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: ownCompanyIds } } });
  }

  await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
};

/**
 * Fixtures the API itself must not be asked to create — ops_exec can raise neither
 * a query (RULE-QRY-01 makes that a BDO/portal act) nor a customer or vendor.
 * Its own customer is created rather than borrowed, so the script is self-contained
 * on a fresh database and never mutates real demo data.
 */
const seedFixtures = async () => {
  const year = new Date().getFullYear();
  const uniq = String(Date.now()).slice(-5);

  const raisedById = (
    await prisma.user.findFirst({ where: { role: "bdo", isActive: true }, select: { id: true } })
  )?.id;
  if (!raisedById) throw new Error("No BDO user to raise the query as — run `node prisma/seed.js --accounts-only`.");

  const company = await prisma.company.create({
    data: { name: TAG, normalizedName: TAG.toLowerCase(), country: "Pakistan", city: "Karachi" },
  });
  const customer = await prisma.customer.create({
    data: {
      referenceNo: `CST-${year}-Z${uniq}`,
      companyId: company.id,
      source: "bdo",
      assignedBdoId: raisedById,
      isActive: true,
    },
  });
  const query = await prisma.query.create({
    data: {
      referenceNo: `QRY-${year}-Z${uniq}`,
      customerId: customer.id,
      raisedById,
      raisedVia: "bdo",
      status: "open",
      services: ["local_transport", "customs_clearance"],
      pickupAddress: "SITE Area, Karachi",
      deliveryAddress: "Sundar Industrial Estate, Lahore",
      senderName: "ZZ Sender",
      senderPhone: "0300-0000001",
      senderAddress: "SITE Area, Karachi",
      receiverName: "ZZ Receiver",
      receiverPhone: "0300-0000002",
      receiverAddress: "Sundar Industrial Estate, Lahore",
      inlandMode: "rail",
      originRailTerminal: "Karachi Cantt Dry Port",
      destinationRailTerminal: "Lahore Dry Port",
      cargoDescription: TAG, // the cleanup handle
      weightKg: 24000,
    },
  });

  let n = 0;
  const mk = (name, type) =>
    prisma.vendor.create({
      data: {
        referenceNo: `VEN-${year}-Z${uniq}${n++}`,
        name,
        normalizedName: name.toLowerCase().replace(/\s+/g, " ").trim(),
        type,
        isActive: true,
      },
    });

  const vendorA = await mk(VENDOR_NAMES[0], "transporter");
  const vendorB = await mk(VENDOR_NAMES[1], "transporter");
  const vendorC = await mk(VENDOR_NAMES[2], "customs_agent");
  const vendorD = await mk(VENDOR_NAMES[3], "rail_operator");

  return { query, vendorA, vendorB, vendorC, vendorD };
};

async function run() {
  await cleanup();
  const { query, vendorA, vendorB, vendorC, vendorD } = await seedFixtures();

  const login = await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
  if (!login.json?.accessToken) {
    throw new Error(`Login failed (${login.status}): ${JSON.stringify(login.json)?.slice(0, 200)} — is the server running?`);
  }
  token = login.json.accessToken;
  const perms = login.json.permissions ?? []; // top-level, not under `user`
  check("login as ops_exec", true);
  check(
    "ops_exec holds rfq.read + rfq.manage + rfq.award",
    ["rfq.read", "rfq.manage", "rfq.award"].every((p) => perms.includes(p)),
    perms.filter((p) => p.startsWith("rfq.")).join(", ") || "none",
  );

  // ── leg coherence guards ──
  const legless = await call("POST", "/rfqs", {
    queryId: query.id,
    requests: [{ service: "local_transport", vendorIds: [vendorA.id] }],
  });
  check("leg-less transport request on a rail query → 400", legless.status === 400, legless.json?.message);

  const legOnCustoms = await call("POST", "/rfqs", {
    queryId: query.id,
    requests: [{ service: "customs_clearance", leg: "first_mile", vendorIds: [vendorC.id] }],
  });
  check("leg on a non-transport service → 400", legOnCustoms.status === 400, legOnCustoms.json?.message);

  const notOnQuery = await call("POST", "/rfqs", {
    queryId: query.id,
    requests: [{ service: "sea_freight", vendorIds: [vendorA.id] }],
  });
  check("service not on the query → 400", notOnQuery.status === 400, notOnQuery.json?.message);

  const lcFinance = await call("POST", "/rfqs", {
    queryId: query.id,
    requests: [{ service: "lc_finance", vendorIds: [vendorA.id] }],
  });
  check("lc_finance is not RFQ-able → 400/422",
    lcFinance.status === 400 || lcFinance.status === 422, String(lcFinance.status));

  // ── batch create: three legs + customs ──
  const created = await call("POST", "/rfqs", {
    queryId: query.id,
    notes: "All-in rate please",
    requests: [
      { service: "local_transport", leg: "first_mile", vendorIds: [vendorA.id, vendorB.id] },
      { service: "local_transport", leg: "middle_mile", vendorIds: [vendorD.id] },
      { service: "local_transport", leg: "last_mile", vendorIds: [vendorB.id] },
      { service: "customs_clearance", vendorIds: [vendorC.id] },
    ],
  });
  const rfqs = created.json?.data ?? [];
  check("POST /rfqs → 201 with four requests (3 legs + customs)", created.status === 201 && rfqs.length === 4, created.json?.message);

  const firstMile = rfqs.find((r) => r.leg === "first_mile");
  const middleMile = rfqs.find((r) => r.leg === "middle_mile");
  const lastMile = rfqs.find((r) => r.leg === "last_mile");
  const customsRfq = rfqs.find((r) => r.service === "customs_clearance");
  check("each transport RFQ carries its leg; customs has none",
    !!firstMile && !!middleMile && !!lastMile && customsRfq?.leg == null);
  check("reference is RFQ-YYYY-NNNNN", /^RFQ-\d{4}-\d{5}$/.test(firstMile?.referenceNo ?? ""), firstMile?.referenceNo);
  check("hydrated RFQ carries the rail + party fields",
    firstMile?.query?.inlandMode === "rail" &&
      firstMile?.query?.originRailTerminal === "Karachi Cantt Dry Port" &&
      firstMile?.query?.senderName === "ZZ Sender");

  const dupeLeg = await call("POST", "/rfqs", {
    queryId: query.id,
    requests: [{ service: "local_transport", leg: "first_mile", vendorIds: [vendorA.id] }],
  });
  check("second open RFQ for the same (service, leg) → 409", dupeLeg.status === 409, dupeLeg.json?.message);

  const dupeNull = await call("POST", "/rfqs", {
    queryId: query.id,
    requests: [{ service: "customs_clearance", vendorIds: [vendorC.id] }],
  });
  check("second open leg-null RFQ for the same service → 409", dupeNull.status === 409, dupeNull.json?.message);

  // ── enter the vendors' rates ──
  const quoteOf = (rfq, vendorId) => rfq.quotes.find((q) => q.vendorId === vendorId);

  const enteredA = await call("PUT", `/rfqs/${firstMile.id}/quotes/${quoteOf(firstMile, vendorA.id).id}`, {
    currency: "PKR",
    lines: [
      { chargeCode: "inland_transport", description: "SITE Area → Karachi Cantt Dry Port", quantity: 2, unitPrice: 150000 },
      { description: "Loading labour", quantity: 1, unitPrice: 12000 },
    ],
  });
  check("PUT quote → 200 and status quoted", enteredA.status === 200 && enteredA.json?.data?.status === "quoted");
  check("total computed server-side (2×150000 + 12000 = 312000)",
    Number(enteredA.json?.data?.totalAmount) === 312000, String(enteredA.json?.data?.totalAmount));

  // A client-sent total must never be believed — the server recomputes from lines.
  const lying = await call("PUT", `/rfqs/${firstMile.id}/quotes/${quoteOf(firstMile, vendorB.id).id}`, {
    currency: "PKR",
    totalAmount: 1,
    lines: [{ description: "SITE Area → Karachi Cantt Dry Port", quantity: 2, unitPrice: 160000 }],
  });
  check("client-sent total ignored (320000, not 1)",
    Number(lying.json?.data?.totalAmount) === 320000, String(lying.json?.data?.totalAmount));

  await call("PUT", `/rfqs/${middleMile.id}/quotes/${quoteOf(middleMile, vendorD.id).id}`, {
    lines: [{ description: "Rail freight Karachi Cantt → Lahore Dry Port", quantity: 1, unitPrice: 180000 }],
  });
  await call("PUT", `/rfqs/${lastMile.id}/quotes/${quoteOf(lastMile, vendorB.id).id}`, {
    lines: [{ description: "Lahore Dry Port → Sundar Industrial Estate", quantity: 1, unitPrice: 60000 }],
  });
  await call("PUT", `/rfqs/${customsRfq.id}/quotes/${quoteOf(customsRfq, vendorC.id).id}`, {
    lines: [{ chargeCode: "customs_clearance", description: "Clearance + examination", quantity: 1, unitPrice: 45000 }],
  });

  // ── awards + guards ──
  const winA = quoteOf(firstMile, vendorA.id);
  const loseB = quoteOf(firstMile, vendorB.id);

  const awarded = await call("POST", `/rfqs/${firstMile.id}/quotes/${winA.id}/select`);
  check("POST select → 200, quote isSelected", awarded.status === 200 && awarded.json?.data?.isSelected === true);

  const afterAward = await call("GET", `/rfqs/${firstMile.id}`);
  check("RFQ flips to awarded", afterAward.json?.data?.status === "awarded", afterAward.json?.data?.status);

  const declineWinner = await call("POST", `/rfqs/${firstMile.id}/quotes/${winA.id}/decline`);
  check("declining the winner → 409", declineWinner.status === 409, declineWinner.json?.message);

  // ── vendor RC ──
  const rcOnLoser = await call("POST", `/rfqs/${firstMile.id}/quotes/${loseB.id}/rc`);
  check("RC for a losing bid → 409", rcOnLoser.status === 409, rcOnLoser.json?.message);

  const rc = await call("POST", `/rfqs/${firstMile.id}/quotes/${winA.id}/rc`);
  check("RC for the winner → 201 with documentId", rc.status === 201 && !!rc.json?.data?.documentId, rc.json?.data?.fileName);

  const vendorDocs = await call("GET", `/documents?ownerType=vendor&ownerId=${vendorA.id}`);
  const rcDoc = (vendorDocs.json?.data?.documents ?? vendorDocs.json?.data ?? []).find?.(
    (d) => d.docType === "rate_confirmation",
  );
  check("vendor documents list the rate confirmation", !!rcDoc, rcDoc?.fileName);

  // ── award the rest, then the cost sheet ──
  await call("POST", `/rfqs/${middleMile.id}/quotes/${quoteOf(middleMile, vendorD.id).id}/select`);
  await call("POST", `/rfqs/${lastMile.id}/quotes/${quoteOf(lastMile, vendorB.id).id}/select`);
  await call("POST", `/rfqs/${customsRfq.id}/quotes/${quoteOf(customsRfq, vendorC.id).id}/select`);

  const sheet = await call("GET", `/rfqs/cost-sheet?queryId=${query.id}`);
  const groups = sheet.json?.data?.groups ?? [];
  check("cost sheet has all four awarded groups", sheet.status === 200 && groups.length === 4,
    groups.map((g) => `${g.service}${g.leg ? `:${g.leg}` : ""}`).join(", "));
  check("groups carry their legs (3 legs + one null)",
    ["first_mile", "middle_mile", "last_mile"].every((l) => groups.some((g) => g.leg === l)) &&
      groups.some((g) => g.leg == null));
  check("cost sheet totals the awarded buy price (312000+180000+60000+45000 = 597000)",
    Number(sheet.json?.data?.costTotal) === 597000, String(sheet.json?.data?.costTotal));

  // ── handoff to the sell side, 15% margin ──
  const chargeLines = groups.flatMap((g, gi) =>
    g.lines.map((l, i) => ({
      service: g.service,
      chargeCode: l.chargeCode ?? undefined,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Math.round(Number(l.unitPrice) * 1.15 * 100) / 100,
      costAmount: Number(l.unitPrice),
      costVendorId: g.vendorId,
      sortOrder: gi * 10 + i,
    })),
  );
  const quotation = await call("POST", "/quotations", { queryId: query.id, currency: "PKR", chargeLines });
  check("POST /quotations from the cost sheet → 201", quotation.status === 201, quotation.json?.data?.referenceNo);
  const savedLines = quotation.json?.data?.chargeLines ?? [];
  check("cost + vendor stored on the quotation lines",
    savedLines.length === chargeLines.length &&
      savedLines.every((l) => l.costAmount != null && l.costVendorId != null));
  check("sell total is the 15% markup (686550)",
    Number(quotation.json?.data?.totalAmount) === 686550, String(quotation.json?.data?.totalAmount));

  // ── cancel rules ──
  const cancelAwarded = await call("POST", `/rfqs/${firstMile.id}/cancel`, {});
  check("cancelling an awarded RFQ → 409", cancelAwarded.status === 409, cancelAwarded.json?.message);

  const fresh = await call("POST", "/rfqs", {
    queryId: query.id,
    requests: [{ service: "local_transport", leg: "first_mile", vendorIds: [vendorB.id] }],
  });
  check("a new RFQ for an awarded (service, leg) is allowed", fresh.status === 201, fresh.json?.message);
  const cancelOpen = await call("POST", `/rfqs/${fresh.json?.data?.[0]?.id}/cancel`, { reason: "test" });
  check("cancelling an open RFQ → 200", cancelOpen.status === 200);

  // ── lists ──
  const listed = await call("GET", `/rfqs?queryId=${query.id}`);
  check("GET /rfqs?queryId= returns this query's requests",
    listed.status === 200 && listed.json?.data?.length >= 4, `${listed.json?.data?.length ?? 0} rows`);
  check("list rows carry progress counters + legs",
    listed.json?.data?.every((r) => typeof r.quotesIn === "number") &&
      listed.json?.data?.some((r) => r.leg === "middle_mile"));

  const missing = await call("GET", "/rfqs/00000000-0000-0000-0000-000000000000");
  check("unknown RFQ id → 404", missing.status === 404);

  const queriesList = await call("GET", "/queries");
  const thisQuery = (queriesList.json?.data ?? []).find((q) => q.id === query.id);
  check("query list carries rfqSummary + rail fields", !!thisQuery?.rfqSummary && thisQuery?.inlandMode === "rail",
    thisQuery?.rfqSummary ? JSON.stringify(thisQuery.rfqSummary) : "absent");
}

run()
  .catch((err) => {
    console.error("\nFATAL:", err.message);
    results.push({ name: "run to completion", ok: false });
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed:", e.message));
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    await prisma.$disconnect();
    process.exit(failed.length ? 1 : 0);
  });
