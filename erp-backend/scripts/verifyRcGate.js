/**
 * The Rate Confirmation gate on Order Lock — end-to-end HTTP verification.
 *
 *   node scripts/verifyRcGate.js            (needs the dev server on :5000)
 *   node scripts/seedRcVerification.js      (run once first — turns the gate on)
 *
 * There is no test framework in this repo, so this is the safety net for the rule the
 * business actually asked for: an order locks against a SIGNED rate confirmation that
 * Operations has looked at. It builds its own company, customer, query and portal
 * login, drives the whole path as four roles, and tears everything down again.
 *
 * What it proves:
 *   · approval publishes the generated RC to the portal but leaves it unverified
 *   · Order Lock refuses while the RC is only attached, naming verification
 *   · the customer can upload a signed copy (the type is customer-uploadable)
 *   · only the shipment's ops owner may verify; a BDO is refused
 *   · a rejection keeps the gate shut, carries its reason, and makes the file
 *     deletable so a corrected copy can replace it (the RULE-DOC-04 carve-out)
 *   · verifying opens the gate, and completing the step derives order_confirmed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const API = "http://localhost:5000/api";
const YEAR = new Date().getFullYear();

let pass = 0, fail = 0;
const check = (label, cond, extra = "") => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra ? " -- " + extra : "")); }
};

const login = async (email, password = "1234567") => {
  const r = await fetch(API + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
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

// A real PDF header, because uploads are magic-byte sniffed (RULE-DOC-02). The bytes
// vary per call so the checksum dedup does not collapse two uploads into one.
const uploadPdf = async (tok, { ownerId, docType, tag }) => {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% signed copy ${tag}\n%%EOF\n`);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), `signed-rc-${tag}.pdf`);
  form.append("ownerType", "shipment");
  form.append("ownerId", ownerId);
  form.append("docType", docType);
  const r = await fetch(API + "/documents", {
    method: "POST", headers: { Authorization: "Bearer " + tok }, body: form,
  });
  let j = null;
  try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};

const created = { queries: [], quotations: [], customers: [], companies: [], contacts: [], shipments: [], users: [] };

const nextRef = async (entity, prefix) => {
  const seq = await prisma.referenceSequence.upsert({
    where: { entity_year: { entity, year: YEAR } },
    create: { entity, year: YEAR, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  return prefix + "-" + YEAR + "-" + String(seq.lastValue).padStart(5, "0");
};

const run = async () => {
  const gateOn = await prisma.documentType.findUnique({ where: { code: "rate_confirmation" } });
  check("the RC gate is switched on (run scripts/seedRcVerification.js first)",
    gateOn?.requiresVerification === true && gateOn?.customerUploadable === true,
    `requiresVerification=${gateOn?.requiresVerification} customerUploadable=${gateOn?.customerUploadable}`);
  if (!gateOn?.requiresVerification) return;

  const ops = await login("ops.exec@consort.test");
  const opsMgr = await login("ops.manager@consort.test");
  const bdo = await login("bdo@consort.test");

  // ── fixture: a BDO-owned query the BDO can approve ──
  const stamp = "rcgate-" + Date.now();
  const company = await prisma.company.create({
    data: { name: "ZZ Verify " + stamp, normalizedName: "zz verify " + stamp },
  });
  created.companies.push(company.id);
  const contact = await prisma.contact.create({
    data: { companyId: company.id, name: "RC Contact", isPrimary: true },
  });
  created.contacts.push(contact.id);
  const customer = await prisma.customer.create({
    data: { referenceNo: await nextRef("customer", "CST"), companyId: company.id, source: "direct", assignedBdoId: null },
  });
  created.customers.push(customer.id);
  const query = await prisma.query.create({
    data: {
      referenceNo: await nextRef("query", "QRY"),
      customerId: customer.id, raisedById: bdo.user.id, raisedVia: "bdo", status: "open",
      customerName: "RC Contact", customerEmail: "rc@example.com", customerPhone: "0300-0000000",
      pickupAddress: "Origin", destinationAddress: "Destination", services: ["sea_freight"],
    },
  });
  created.queries.push(query.id);

  // A portal login for this customer — none is seeded.
  const portalUser = await prisma.user.create({
    data: {
      email: `zz.portal.${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash("1234567", 10),
      role: "customer",
      customerId: customer.id,
    },
  });
  created.users.push(portalUser.id);
  const portal = await login(portalUser.email);

  // ── approve into a shipment — as the CUSTOMER (ADR-056: no internal role approves) ──
  const q = await call(ops.token, "POST", "/quotations", {
    queryId: query.id, currency: "PKR",
    chargeLines: [{ description: "Ocean freight", quantity: 1, unitPrice: 5000 }],
  });
  created.quotations.push(q.body?.data?.id);
  await call(ops.token, "POST", "/quotations/" + q.body?.data?.id + "/send");
  const qrow = await prisma.quotation.findUnique({ where: { id: q.body?.data?.id } });
  const byBdoAppr = await call(bdo.token, "POST", "/quotations/" + q.body?.data?.id + "/approve", { rowVersion: qrow.rowVersion });
  check("a BDO can no longer approve on the customer's behalf (403)", byBdoAppr.status === 403, "got " + byBdoAppr.status);
  const appr = await call(portal.token, "POST", "/quotations/" + q.body?.data?.id + "/approve", { rowVersion: qrow.rowVersion });
  const shipmentId = appr.body?.data?.shipmentId;
  check("the portal customer approves it into a shipment", appr.status === 200 && !!shipmentId,
    "got " + appr.status + " " + JSON.stringify(appr.body).slice(0, 160));
  if (!shipmentId) return;
  created.shipments.push(shipmentId);

  console.log("\nThe generated RC");
  const generated = await prisma.document.findFirst({
    where: { ownerType: "shipment", ownerId: shipmentId, docType: "rate_confirmation", deletedAt: null },
  });
  check("an RC is generated at approval", !!generated, generated?.fileName);
  check("it is published so the customer can download and sign it", generated?.isPublished === true);
  check("it is NOT verified, so it does not open the gate on its own",
    generated?.verificationStatus === "unverified", generated?.verificationStatus);

  console.log("\nOrder Lock refuses while nothing is verified");
  await call(ops.token, "POST", "/shipments/" + shipmentId + "/claim");
  const lockStep = await prisma.otdStep.findFirst({ where: { shipmentId, stepCode: "order_lock" } });
  check("the order_lock step is on the path", !!lockStep, lockStep?.displayNo);
  let ship = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  const early = await call(ops.token, "PATCH",
    "/otd/" + shipmentId + "/steps/" + lockStep.displayNo + "/complete", { rowVersion: ship.rowVersion });
  check("completing it 422s", early.status === 422, "got " + early.status);
  check("  ...naming verification, not a missing file",
    /awaiting verification/i.test(early.body?.message ?? ""), early.body?.message);

  const checklist = await call(ops.token, "GET", "/documents/required/" + shipmentId);
  const lockEntry = (checklist.body?.data?.checklist ?? []).find((c) => c.stepCode === "order_lock");
  check("the checklist reports it as unverified rather than missing",
    (lockEntry?.unverified ?? []).includes("rate_confirmation") && !(lockEntry?.missing ?? []).includes("rate_confirmation"),
    JSON.stringify(lockEntry));

  // RULE-QT-09 — Order Lock is a HARD gate: the ops owner holds shipment.force_override,
  // and a forced completion of the next step must still be refused while the signed RC
  // is not verified.
  const nextStep = await prisma.otdStep.findFirst({
    where: { shipmentId, canonicalNo: { gt: lockStep.canonicalNo }, ownerDepartment: "operations" },
    orderBy: { canonicalNo: "asc" },
  });
  if (nextStep) {
    ship = await prisma.shipment.findUnique({ where: { id: shipmentId } });
    const forced = await call(ops.token, "PATCH",
      "/otd/" + shipmentId + "/steps/" + nextStep.displayNo + "/complete",
      { rowVersion: ship.rowVersion, forceReason: "trying to skip the contract gate" });
    check("forcing past Order Lock is refused even with force_override (403)", forced.status === 403,
      "got " + forced.status + " " + JSON.stringify(forced.body).slice(0, 160));
    check("  ...naming the gate that cannot be overridden",
      /cannot be overridden/i.test(forced.body?.message ?? ""), forced.body?.message);
  }

  console.log("\nThe customer sends the signed copy back");
  const up = await uploadPdf(portal.token, { ownerId: shipmentId, docType: "rate_confirmation", tag: "a" });
  check("the portal customer can upload a signed RC (201)", up.status === 201,
    "got " + up.status + " " + JSON.stringify(up.body).slice(0, 200));
  const signedId = up.body?.data?.id;
  check("it lands unverified", up.body?.data?.verificationStatus === "unverified", up.body?.data?.verificationStatus);

  console.log("\nOnly the shipment's ops owner verifies");
  const byBdo = await call(bdo.token, "POST", "/documents/" + signedId + "/verification", { status: "verified" });
  check("a BDO is refused (403)", byBdo.status === 403, "got " + byBdo.status);
  const byOtherOps = await call(opsMgr.token, "POST", "/documents/" + signedId + "/verification", { status: "verified" });
  check("a non-owner ops user is refused (403)", byOtherOps.status === 403, "got " + byOtherOps.status);
  const noNote = await call(ops.token, "POST", "/documents/" + signedId + "/verification", { status: "rejected" });
  check("rejecting without a reason 400s", noNote.status === 400, "got " + noNote.status);

  console.log("\nRejection keeps the gate shut and frees the file");
  const rej = await call(ops.token, "POST", "/documents/" + signedId + "/verification",
    { status: "rejected", note: "Unsigned — page 2 has no signature" });
  check("the owner can reject it (200)", rej.status === 200, "got " + rej.status);
  ship = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  const afterReject = await call(ops.token, "PATCH",
    "/otd/" + shipmentId + "/steps/" + lockStep.displayNo + "/complete", { rowVersion: ship.rowVersion });
  check("the step is still refused", afterReject.status === 422, "got " + afterReject.status);
  const del = await call(ops.token, "DELETE", "/documents/" + signedId, { reason: "rejected copy" });
  check("a rejected step-mandatory document CAN be deleted (RULE-DOC-04 carve-out)",
    del.status === 200, "got " + del.status + " " + JSON.stringify(del.body).slice(0, 160));
  const delGenerated = await call(ops.token, "DELETE", "/documents/" + generated.id, { reason: "should be refused" });
  check("an unverified one still cannot", delGenerated.status === 409, "got " + delGenerated.status);

  console.log("\nVerifying opens the gate");
  const up2 = await uploadPdf(portal.token, { ownerId: shipmentId, docType: "rate_confirmation", tag: "b" });
  check("a corrected copy uploads (201)", up2.status === 201, "got " + up2.status);
  const ok = await call(ops.token, "POST", "/documents/" + up2.body?.data?.id + "/verification", { status: "verified" });
  check("the owner verifies it (200)", ok.status === 200, "got " + ok.status);
  const again = await call(ops.token, "POST", "/documents/" + up2.body?.data?.id + "/verification", { status: "verified" });
  check("verifying twice is idempotent (200)", again.status === 200, "got " + again.status);

  const steps = await call(ops.token, "GET", "/shipments/" + shipmentId);
  const uiStep = (steps.body?.data?.otdSteps ?? []).find((s) => s.stepCode === "order_lock");
  const rcAction = (uiStep?.actions ?? []).find((a) => a.docType === "rate_confirmation");
  check("the checklist item reports satisfied + verified",
    rcAction?.satisfied === true && rcAction?.verificationStatus === "verified" && rcAction?.requiresVerification === true,
    JSON.stringify(rcAction));
  check("  ...and points at the SIGNED copy, not the generated one",
    rcAction?.documentId === up2.body?.data?.id, rcAction?.documentId);

  ship = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  const done = await call(ops.token, "PATCH",
    "/otd/" + shipmentId + "/steps/" + lockStep.displayNo + "/complete", { rowVersion: ship.rowVersion });
  check("the order locks (200)", done.status === 200, "got " + done.status + " " + JSON.stringify(done.body).slice(0, 200));
  const finalShip = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  check("status derives to order_confirmed", finalShip?.status === "order_confirmed", finalShip?.status);
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
    await prisma.document.deleteMany({ where: { ownerType: "quotation", ownerId: qid } });
    await prisma.quotationChargeLine.deleteMany({ where: { quotationId: qid } });
    await prisma.quotation.deleteMany({ where: { id: qid } });
  }
  for (const qid of created.queries) {
    await prisma.document.deleteMany({ where: { ownerType: "query", ownerId: qid } });
    await prisma.vendorRfq.deleteMany({ where: { queryId: qid } });
    await prisma.query.deleteMany({ where: { id: qid } });
  }
  for (const uid of created.users) {
    // Deliveries first — notification_deliveries.notification_id is RESTRICT.
    await prisma.notificationDelivery.deleteMany({ where: { notification: { userId: uid } } });
    await prisma.notification.deleteMany({ where: { userId: uid } });
    await prisma.refreshToken.deleteMany({ where: { userId: uid } });
    await prisma.loginActivity.deleteMany({ where: { userId: uid } });
    await prisma.activationToken.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
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
