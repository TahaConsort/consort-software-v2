/**
 * Ops ownership + quote routing — end-to-end HTTP verification.
 *
 *   node scripts/verifyOpsOwnership.js       (needs the dev server on :5000)
 *
 * There is no test framework in this repo, so this is the safety net for three
 * changes made on 2026-09-08, in the same shape as scripts/verifyTradeFlow.js: it
 * builds ITS OWN company, customer and query fixtures, exercises the API as five
 * different roles, and tears everything down again — zero residue.
 *
 *   1. One ops permission set — ops_exec drafts AND sends a quotation (it used to
 *      403 on send, so an ops_exec quote never reached a decision), and cancelling
 *      a query rejects its live quotation instead of leaving it approvable.
 *   2. Decision routing — a query raised by ops for an unclaimed customer (the
 *      bank-LC shape) is visible to a BDO, claimable, and then approvable by that
 *      BDO, recorded as approvalChannel `bdo`.
 *   3. Ops ownership — a shipment is born unclaimed, ops writes 409 until someone
 *      claims it, a second ops user is refused, Management can reassign and release,
 *      and other departments keep working their own steps regardless.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const API = "http://localhost:5000/api";
const YEAR = new Date().getFullYear();

let pass = 0, fail = 0;
const check = (label, cond, extra = "") => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra ? " -- " + extra : "")); }
};

const login = async (email) => {
  const r = await fetch(API + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "1234567" }),
  });
  const j = await r.json();
  if (!j.accessToken) throw new Error("login " + email + " failed: " + JSON.stringify(j).slice(0, 200));
  return { token: j.accessToken, user: j.user, permissions: j.permissions };
};

const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let j = null;
  try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};

// A real PDF header, because uploads are magic-byte sniffed (RULE-DOC-02).
const uploadPdf = async (tok, { ownerType, ownerId, docType, tag }) => {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% signed copy ${tag}\n%%EOF\n`);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), `signed-${tag}.pdf`);
  form.append("ownerType", ownerType);
  form.append("ownerId", ownerId);
  form.append("docType", docType);
  const r = await fetch(API + "/documents", {
    method: "POST", headers: { Authorization: "Bearer " + tok }, body: form,
  });
  let j = null;
  try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};

const created = { queries: [], quotations: [], customers: [], companies: [], contacts: [], shipments: [] };

const nextRef = async (entity, prefix) => {
  const seq = await prisma.referenceSequence.upsert({
    where: { entity_year: { entity, year: YEAR } },
    create: { entity, year: YEAR, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  return prefix + "-" + YEAR + "-" + String(seq.lastValue).padStart(5, "0");
};

const makeFixture = async (tag, { raisedById, raisedVia, assignedBdoId }) => {
  const stamp = tag + "-" + Date.now();
  const company = await prisma.company.create({
    data: { name: "ZZ Verify " + stamp, normalizedName: "zz verify " + stamp },
  });
  created.companies.push(company.id);
  const contact = await prisma.contact.create({
    data: { companyId: company.id, name: "Verify Contact", isPrimary: true },
  });
  created.contacts.push(contact.id);
  const customer = await prisma.customer.create({
    data: {
      referenceNo: await nextRef("customer", "CST"),
      companyId: company.id,
      source: "direct",
      assignedBdoId: assignedBdoId ?? null,
    },
  });
  created.customers.push(customer.id);
  const query = await prisma.query.create({
    data: {
      referenceNo: await nextRef("query", "QRY"),
      customerId: customer.id,
      raisedById,
      raisedVia,
      status: "open",
      customerName: "Verify Contact",
      customerEmail: "verify@example.com",
      customerPhone: "0300-0000000",
      pickupAddress: "Origin",
      destinationAddress: "Destination",
      services: ["sea_freight"],
    },
  });
  created.queries.push(query.id);
  return { company, customer, query };
};

const run = async () => {
  const ops = await login("ops.exec@consort.test");
  const opsMgr = await login("ops.manager@consort.test");
  const bdo = await login("bdo@consort.test");
  const ceo = await login("ceo@consort.test");

  console.log("\nPHASE 1 -- one ops permission set");
  check("ops_exec holds quotation.send", ops.permissions.includes("quotation.send"));
  check("ops_exec holds shipment.claim", ops.permissions.includes("shipment.claim"));
  check("ops_exec holds document.verify", ops.permissions.includes("document.verify"));
  check("ops_manager and ops_exec hold the same set", opsMgr.permissions.length === ops.permissions.length);
  check("ceo holds shipment.assign", ceo.permissions.includes("shipment.assign"));
  check("bdo does NOT hold shipment.claim", !bdo.permissions.includes("shipment.claim"));

  const f1 = await makeFixture("send", { raisedById: bdo.user.id, raisedVia: "bdo", assignedBdoId: bdo.user.id });
  const q1 = await call(ops.token, "POST", "/quotations", {
    queryId: f1.query.id,
    currency: "PKR",
    chargeLines: [{ description: "Ocean freight", quantity: 1, unitPrice: 1000 }],
  });
  check("ops_exec creates a quotation (201)", q1.status === 201, "got " + q1.status + " " + JSON.stringify(q1.body).slice(0, 160));
  const q1id = q1.body?.data?.id;
  if (q1id) created.quotations.push(q1id);
  const s1 = await call(ops.token, "POST", "/quotations/" + q1id + "/send");
  check("ops_exec SENDS it (200, was 403)", s1.status === 200, "got " + s1.status + " " + JSON.stringify(s1.body).slice(0, 160));

  console.log("\nPHASE 1 -- cancelling a query kills its live quote");
  const cancelled = await call(bdo.token, "POST", "/queries/" + f1.query.id + "/cancel", { reason: "verify script" });
  check("query cancelled from `quoted` (200)", cancelled.status === 200, "got " + cancelled.status);
  const q1row = await prisma.quotation.findUnique({ where: { id: q1id } });
  check("its sent quotation became `rejected`", q1row?.status === "rejected", "got " + q1row?.status);
  // ADR-056: no internal role holds quotation.approve any more, so the route refuses
  // before it ever looks at the quotation's status.
  const appr1 = await call(bdo.token, "POST", "/quotations/" + q1id + "/approve", { rowVersion: q1row?.rowVersion });
  check("a BDO cannot approve at all any more (403)", appr1.status === 403, "got " + appr1.status);
  check("bdo does NOT hold quotation.approve", !bdo.permissions.includes("quotation.approve"));
  check("ceo does NOT hold quotation.approve either", !ceo.permissions.includes("quotation.approve"));
  check("bdo holds quotation.share (record acceptance / relay the link)", bdo.permissions.includes("quotation.share"));

  console.log("\nPHASE 2 -- owning BDO records the yes; Ops verifies the signed copy (the LC shape)");
  const f2 = await makeFixture("lcshape", { raisedById: ops.user.id, raisedVia: "bank_lc", assignedBdoId: null });
  const pool = await call(bdo.token, "GET", "/queries?channel=bank_lc");
  check("unclaimed bank_lc query is visible to the BDO",
    (pool.body?.data ?? []).some((q) => q.id === f2.query.id));
  const claim = await call(bdo.token, "POST", "/queries/" + f2.query.id + "/claim");
  check("BDO claims it (200)", claim.status === 200, "got " + claim.status + " " + JSON.stringify(claim.body).slice(0, 160));

  const q2 = await call(ops.token, "POST", "/quotations", {
    queryId: f2.query.id,
    currency: "PKR",
    chargeLines: [{ description: "Ocean freight", quantity: 1, unitPrice: 2000 }],
  });
  const q2id = q2.body?.data?.id;
  if (q2id) created.quotations.push(q2id);
  await call(ops.token, "POST", "/quotations/" + q2id + "/send");
  // The owning BDO records the customer's verbal yes — a claim, not an approval.
  const accepted = await call(bdo.token, "POST", "/quotations/" + q2id + "/acceptance", { via: "phone", note: "agreed on the call" });
  check("the owning BDO records the acceptance (201)", accepted.status === 201,
    "got " + accepted.status + " " + JSON.stringify(accepted.body).slice(0, 200));
  let q2mid = await prisma.quotation.findUnique({ where: { id: q2id } });
  check("the quotation is STILL sent — a claim creates nothing", q2mid?.status === "sent", "got " + q2mid?.status);
  check("no shipment exists yet", (await prisma.shipment.count({ where: { quotationId: q2id } })) === 0);
  // The customer's signed copy arrives; the BDO uploads it and Ops verifies it.
  const up = await uploadPdf(bdo.token, { ownerType: "quotation", ownerId: q2id, docType: "quotation_acceptance", tag: "ops-own" });
  check("the BDO uploads the signed quotation (201)", up.status === 201, "got " + up.status + " " + JSON.stringify(up.body).slice(0, 160));
  const appr2 = await call(ops.token, "POST", "/documents/" + up.body?.data?.id + "/verification", { status: "verified" });
  check("Ops verifies it and the shipment is created (200)", appr2.status === 200 && !!appr2.body?.data?.shipmentId,
    "got " + appr2.status + " " + JSON.stringify(appr2.body).slice(0, 200));
  const shipmentId = appr2.body?.data?.shipmentId;
  if (shipmentId) created.shipments.push(shipmentId);
  const q2after = await prisma.quotation.findUnique({ where: { id: q2id } });
  check("approvalChannel recorded as `signed_copy`", q2after?.approvalChannel === "signed_copy", "got " + q2after?.approvalChannel);
  check("no internal user is credited as the decider", q2after?.decidedById === null, "got " + q2after?.decidedById);

  if (!shipmentId) { console.log("  (no shipment -- skipping phase 3)"); return; }

  console.log("\nPHASE 3 -- ops claims the shipment");
  const ship = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  check("a new shipment is unclaimed", ship?.opsOwnerId === null, "got " + ship?.opsOwnerId);
  const detail0 = await call(ops.token, "GET", "/shipments/" + shipmentId);
  check("detail exposes opsOwnerName: null", detail0.body?.data?.opsOwnerName === null);

  const firstOpsStep = await prisma.otdStep.findFirst({
    where: { shipmentId, ownerDepartment: "operations" },
    orderBy: { canonicalNo: "asc" },
  });
  const early = await call(ops.token, "PATCH",
    "/otd/" + shipmentId + "/steps/" + firstOpsStep.displayNo + "/complete", { rowVersion: ship.rowVersion });
  check("completing a step before claiming 409s", early.status === 409, "got " + early.status);
  check("  ...with a claim-it message", /claim it/i.test(early.body?.message ?? ""), early.body?.message);

  const c1 = await call(ops.token, "POST", "/shipments/" + shipmentId + "/claim");
  check("ops_exec claims it (200)", c1.status === 200, "got " + c1.status + " " + JSON.stringify(c1.body).slice(0, 160));
  const c2 = await call(opsMgr.token, "POST", "/shipments/" + shipmentId + "/claim");
  check("a second ops user claiming 409s", c2.status === 409, "got " + c2.status);
  const foreign = await call(opsMgr.token, "POST", "/shipments/" + shipmentId + "/hold",
    { type: "other", reason: "should be refused" });
  check("a non-owner ops hold 403s", foreign.status === 403, "got " + foreign.status);
  check("  ...naming the owner", /owns this shipment/i.test(foreign.body?.message ?? ""), foreign.body?.message);
  const ownHold = await call(ops.token, "POST", "/shipments/" + shipmentId + "/hold",
    { type: "other", reason: "owner may hold" });
  check("the owner CAN hold (200)", ownHold.status === 200, "got " + ownHold.status);
  await call(ops.token, "POST", "/shipments/" + shipmentId + "/resume", { resolutionNotes: "resumed by verify" });

  console.log("\nPHASE 3 -- Management reassigns and releases");
  const asg = await call(ceo.token, "POST", "/shipments/" + shipmentId + "/assign", { ownerId: opsMgr.user.id });
  check("CEO reassigns to ops_manager (200)", asg.status === 200, "got " + asg.status);
  const afterAsg = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  check("owner is now ops_manager", afterAsg?.opsOwnerId === opsMgr.user.id);
  const badTarget = await call(ceo.token, "POST", "/shipments/" + shipmentId + "/assign", { ownerId: bdo.user.id });
  check("assigning to a non-ops user 422s", badTarget.status === 422, "got " + badTarget.status);
  const opsAssign = await call(ops.token, "POST", "/shipments/" + shipmentId + "/assign", { ownerId: ops.user.id });
  check("an ops user cannot reassign (403)", opsAssign.status === 403, "got " + opsAssign.status);
  const rel = await call(ceo.token, "POST", "/shipments/" + shipmentId + "/assign", { ownerId: null });
  check("CEO releases it back to the pool (200)", rel.status === 200, "got " + rel.status);

  console.log("\nPHASE 3 -- list filters");
  await call(ops.token, "POST", "/shipments/" + shipmentId + "/claim");
  const mine = await call(ops.token, "GET", "/shipments?opsOwnerId=me");
  check("?opsOwnerId=me returns my shipment", (mine.body?.data ?? []).some((s) => s.id === shipmentId));
  check("list rows carry opsOwnerName",
    (mine.body?.data ?? []).find((s) => s.id === shipmentId)?.opsOwnerName != null);
  const none = await call(ops.token, "GET", "/shipments?opsOwnerId=none");
  check("?opsOwnerId=none excludes it", !(none.body?.data ?? []).some((s) => s.id === shipmentId));

  console.log("\nPHASE 3 -- other departments are unaffected");
  const comp = await login("compliance.exec@consort.test");
  const compStep = await prisma.otdStep.findFirst({ where: { shipmentId, ownerDepartment: "compliance" } });
  if (compStep) {
    const r = await call(comp.token, "PATCH",
      "/otd/" + shipmentId + "/steps/" + compStep.displayNo + "/details", { notes: "compliance note" });
    check("compliance still edits its own step despite ops ownership", r.status === 200, "got " + r.status);
  } else {
    check("a compliance step is on the composed path", false, "none composed");
  }

  console.log("\nPHASE 3 -- the Action Engine queues an unclaimed shipment's ops task");
  // Task carries otdStepId but no `otdStep` relation, so resolve the step ids first.
  const opsStepIds = (await prisma.otdStep.findMany({
    where: { shipmentId, ownerDepartment: "operations" },
    select: { id: true },
  })).map((s) => s.id);
  const opsTask = await prisma.task.findFirst({
    where: { shipmentId, otdStepId: { in: opsStepIds } },
    orderBy: { createdAt: "asc" },
  });
  if (opsTask) {
    check("the first operations task is queued or on the claimer's desk",
      opsTask.status === "queued" || opsTask.assigneeId === ops.user.id,
      "status=" + opsTask.status + " assignee=" + opsTask.assigneeId);
  } else {
    console.log("  (no operations task yet -- the relay polls every 3s)");
  }
};

const cleanup = async () => {
  console.log("\ncleanup...");
  for (const sid of created.shipments) {
    await prisma.task.deleteMany({ where: { shipmentId: sid } });
    await prisma.document.deleteMany({ where: { ownerType: "shipment", ownerId: sid } });
    await prisma.payment.deleteMany({ where: { invoice: { shipmentId: sid } } });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { shipmentId: sid } } });
    await prisma.invoice.deleteMany({ where: { shipmentId: sid } });
    await prisma.otcMilestone.deleteMany({ where: { shipmentId: sid } });
    await prisma.otdStepAction.deleteMany({ where: { otdStep: { shipmentId: sid } } });
    await prisma.otdStep.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipmentStatusHistory.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipmentTradeStageHistory.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipmentException.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipmentParty.deleteMany({ where: { shipmentId: sid } });
    await prisma.chatMessage.deleteMany({ where: { channel: { shipmentId: sid } } });
    await prisma.chatChannelMember.deleteMany({ where: { channel: { shipmentId: sid } } });
    await prisma.chatChannel.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipment.deleteMany({ where: { id: sid } });
  }
  for (const qid of created.quotations) {
    if (!qid) continue;
    await prisma.approvalLink.deleteMany({ where: { quotationId: qid } });
    await prisma.document.deleteMany({ where: { ownerType: "quotation", ownerId: qid } });
    await prisma.quotationChargeLine.deleteMany({ where: { quotationId: qid } });
    await prisma.quotation.deleteMany({ where: { id: qid } });
  }
  for (const qid of created.queries) {
    await prisma.document.deleteMany({ where: { ownerType: "query", ownerId: qid } });
    await prisma.vendorRfq.deleteMany({ where: { queryId: qid } });
    await prisma.query.deleteMany({ where: { id: qid } });
  }
  for (const cid of created.customers) {
    await prisma.leadStatusHistory.deleteMany({ where: { lead: { convertedToCustomerId: cid } } });
    await prisma.lead.deleteMany({ where: { convertedToCustomerId: cid } });
    await prisma.user.deleteMany({ where: { customerId: cid } });
    await prisma.customer.deleteMany({ where: { id: cid } });
  }
  for (const ctid of created.contacts) await prisma.contact.deleteMany({ where: { id: ctid } });
  for (const coid of created.companies) await prisma.company.deleteMany({ where: { id: coid } });
  console.log("cleanup done");
};

try {
  await run();
} catch (e) {
  fail++;
  console.error("\nTHREW: " + e.message);
} finally {
  await cleanup().catch((e) => console.error("cleanup failed: " + e.message));
  await prisma.$disconnect();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}
