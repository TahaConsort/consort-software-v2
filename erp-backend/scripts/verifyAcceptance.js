/**
 * Secure contract acceptance (ADR-056) — end-to-end verification.
 *
 *   node scripts/verifyAcceptance.js          (needs the dev server on :5000)
 *
 * There is no test framework in this repo, so this is the safety net for the rule the
 * business asked for after a BDO "approved" a quote the customer had not accepted and
 * Operations worked a shipment that never happened: a shipment is born ONLY from the
 * customer's own act. It builds its own company, customer, portal login, queries and
 * quotations, drives the API as a BDO, two ops users, Management and the portal
 * customer, and tears everything down — zero residue.
 *
 * What it proves:
 *   · no internal role holds `quotation.approve`; a staff POST /approve is 403 and
 *     creates NOTHING — no shipment, no task, no invoice, no chat channel;
 *   · POST /acceptance records the claim and mints the link, and the quotation is
 *     still `sent`; re-claiming supersedes the link; a link never outlives validity;
 *   · the signed copy: sales uploads it, sales cannot verify it, the uploader cannot
 *     verify their own, a rejection leaves no shipment and tells the uploader, and an
 *     ops verification creates the shipment as `signed_copy` with no internal decider;
 *   · the pivot guard: an expired quote cannot be claimed, and verifying its signed
 *     copy rolls the verification back with the refused pivot;
 *   · RULE-QT-09: Order Lock cannot be forced past, even with `shipment.force_override`;
 *   · cancelling before Order Lock unwinds the enquiry so it can be re-quoted;
 *     cancelling after leaves the approved quotation alone;
 *   · the customer and their BDO get the approval receipt; the lapse sweep tells the
 *     claimer when a link expires unused.
 */
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { sweepAcceptanceLapses } from "../jobs/scheduler.js";
import { UPLOAD_ROOT } from "../modules/document/document.service.js";

const BASE = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:5000/api";
const PASSWORD = process.env.PASSWORD ?? "1234567";
const TAG = `ZZC${Date.now().toString().slice(-6)}`;
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

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (res.status === 429) throw new Error("Rate limited (429) — wait for the public limiter window to reset");
  return { status: res.status, body: json };
};

const login = async (email) => {
  const r = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
  if (!r.body?.accessToken) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  return { token: r.body.accessToken, user: r.body.user, permissions: r.body.permissions ?? [] };
};

// A real PDF header, because uploads are magic-byte sniffed (RULE-DOC-02). The bytes
// vary per call so the checksum dedup does not collapse two uploads into one.
const uploadPdf = async (token, { ownerType, ownerId, docType, tag }) => {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% ${TAG} signed copy ${tag}\n%%EOF\n`);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), `signed-${tag}.pdf`);
  form.append("ownerType", ownerType);
  form.append("ownerId", ownerId);
  form.append("docType", docType);
  const r = await fetch(`${BASE}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* no body */
  }
  return { status: r.status, body: json };
};

// The relay polls every 3s; a notification is asserted by waiting for it, not by hoping.
const waitFor = async (probe, { timeoutMs = 15000, everyMs = 500 } = {}) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return null;
};

const ids = { quotations: [], shipments: [], users: [] };
const fixtures = {};

const makeQuotation = async ({ validityDate } = {}) => {
  const n = ids.quotations.length + 1;
  const query = await prisma.query.create({
    data: {
      referenceNo: `QRY-${TAG}-${n}`,
      customerId: fixtures.customer.id,
      raisedById: fixtures.bdo.id,
      raisedVia: "bdo",
      status: "quoted",
      customerName: `${TAG} Contact`,
      customerEmail: `${TAG}@example.test`,
      customerPhone: "0300-0000000",
      pickupAddress: "Faisalabad, Pakistan",
      destinationAddress: "Antwerp, Belgium",
      services: ["sea_freight"],
    },
  });
  const quotation = await prisma.quotation.create({
    data: {
      referenceNo: `QT-${TAG}-${n}`,
      queryId: query.id,
      status: "sent",
      services: ["sea_freight"],
      currency: "PKR",
      totalAmount: 150000,
      validityDate: validityDate ?? null,
      createdById: fixtures.ops.id,
      sentById: fixtures.ops.id,
      sentAt: new Date(),
      chargeLines: {
        create: [{ service: "sea_freight", description: "Ocean Freight", quantity: 1, unitPrice: 150000, amount: 150000, sortOrder: 0 }],
      },
    },
    include: { chargeLines: true, query: true },
  });
  ids.quotations.push({ quotationId: quotation.id, queryId: query.id });
  return quotation;
};

const buildFixtures = async () => {
  const [bdo, ops, opsMgr, ceo] = await Promise.all([
    prisma.user.findFirst({ where: { email: "bdo@consort.test" } }),
    prisma.user.findFirst({ where: { email: "ops.exec@consort.test" } }),
    prisma.user.findFirst({ where: { email: "ops.manager@consort.test" } }),
    prisma.user.findFirst({ where: { email: "ceo@consort.test" } }),
  ]);
  if (!bdo || !ops || !opsMgr || !ceo) throw new Error("Seeded accounts missing — run `node prisma/seed.js --accounts-only`");
  Object.assign(fixtures, { bdo, ops, opsMgr, ceo });

  const company = await prisma.company.create({
    data: { name: `${TAG} Acceptance Co`, normalizedName: `${TAG} acceptance co`.toLowerCase(), country: "PK" },
  });
  const customer = await prisma.customer.create({
    data: { referenceNo: `CST-${TAG}`, companyId: company.id, source: "direct", assignedBdoId: bdo.id },
  });
  const portalUser = await prisma.user.create({
    data: {
      email: `${TAG.toLowerCase()}.portal@example.test`,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "customer",
      customerId: customer.id,
    },
  });
  ids.users.push(portalUser.id);
  Object.assign(fixtures, { company, customer, portalUser });
};

const teardown = async () => {
  for (const shipmentId of ids.shipments) {
    const steps = await prisma.otdStep.findMany({ where: { shipmentId }, select: { id: true } });
    await prisma.otdStepAction.deleteMany({ where: { otdStepId: { in: steps.map((s) => s.id) } } });
    await prisma.document.deleteMany({ where: { ownerType: "shipment", ownerId: shipmentId } });
    await prisma.task.deleteMany({ where: { shipmentId } });
    await prisma.chatChannelMember.deleteMany({ where: { channel: { shipmentId } } });
    await prisma.chatChannel.deleteMany({ where: { shipmentId } });
    await prisma.otdStep.deleteMany({ where: { shipmentId } });
    await prisma.otcMilestone.deleteMany({ where: { shipmentId } });
    await prisma.shipmentParty.deleteMany({ where: { shipmentId } });
    await prisma.shipmentStatusHistory.deleteMany({ where: { shipmentId } });
    await prisma.shipmentTradeStageHistory.deleteMany({ where: { shipmentId } });
    await prisma.shipmentException.deleteMany({ where: { shipmentId } });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { shipmentId } } });
    await prisma.payment.deleteMany({ where: { invoice: { shipmentId } } });
    await prisma.invoice.deleteMany({ where: { shipmentId } });
    await prisma.shipment.deleteMany({ where: { id: shipmentId } });
  }
  const quotationIds = ids.quotations.map((q) => q.quotationId);
  // Uploaded bytes live under uploads/ by storageKey — remove them with their rows.
  const docs = await prisma.document.findMany({ where: { ownerType: "quotation", ownerId: { in: quotationIds } } });
  for (const d of docs) fs.promises.unlink(path.join(UPLOAD_ROOT, d.storageKey)).catch(() => {});
  await prisma.document.deleteMany({ where: { ownerType: "quotation", ownerId: { in: quotationIds } } });
  await prisma.approvalLink.deleteMany({ where: { quotationId: { in: quotationIds } } });
  await prisma.quotationChargeLine.deleteMany({ where: { quotationId: { in: quotationIds } } });
  await prisma.quotation.deleteMany({ where: { id: { in: quotationIds } } });
  await prisma.query.deleteMany({ where: { id: { in: ids.quotations.map((q) => q.queryId) } } });
  await prisma.auditLog.deleteMany({ where: { resourceId: { in: [...quotationIds, ...ids.shipments, ...docs.map((d) => d.id)] } } });
  for (const uid of ids.users) {
    await prisma.notificationDelivery.deleteMany({ where: { notification: { userId: uid } } });
    await prisma.notification.deleteMany({ where: { userId: uid } });
    await prisma.refreshToken.deleteMany({ where: { userId: uid } });
    await prisma.loginActivity.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
  }
  // The notifications this run sent to the SEEDED accounts — matched by the tag in the title.
  const noisy = await prisma.notification.findMany({ where: { title: { contains: TAG } }, select: { id: true } });
  await prisma.notificationDelivery.deleteMany({ where: { notificationId: { in: noisy.map((n) => n.id) } } });
  await prisma.notification.deleteMany({ where: { id: { in: noisy.map((n) => n.id) } } });
  if (fixtures.customer) await prisma.customer.deleteMany({ where: { id: fixtures.customer.id } });
  if (fixtures.company) await prisma.company.deleteMany({ where: { id: fixtures.company.id } });
};

const countsFor = async (quotationId) => {
  const shipments = await prisma.shipment.findMany({ where: { quotationId }, select: { id: true } });
  const sids = shipments.map((s) => s.id);
  return {
    shipments: sids.length,
    tasks: sids.length ? await prisma.task.count({ where: { shipmentId: { in: sids } } }) : 0,
    invoices: await prisma.invoice.count({ where: { quotationId } }),
    channels: sids.length ? await prisma.chatChannel.count({ where: { shipmentId: { in: sids } } }) : 0,
  };
};

async function run() {
  await buildFixtures();
  const bdo = await login("bdo@consort.test");
  const ops = await login("ops.exec@consort.test");
  const opsMgr = await login("ops.manager@consort.test");
  const ceo = await login("ceo@consort.test");
  const portal = await login(fixtures.portalUser.email);

  /* ── 1. Nobody internal approves ─────────────────────────────────────── */
  console.log("\nPermissions (ADR-056)");
  check("bdo does not hold quotation.approve", !bdo.permissions.includes("quotation.approve"));
  check("ops does not hold quotation.approve", !ops.permissions.includes("quotation.approve"));
  check("ceo does not hold quotation.approve", !ceo.permissions.includes("quotation.approve"));
  check("the portal customer DOES", portal.permissions.includes("quotation.approve"));
  check("bdo holds quotation.share", bdo.permissions.includes("quotation.share"));
  check("ceo holds quotation.share (records / relays, never approves)", ceo.permissions.includes("quotation.share"));
  check("ops holds document.verify", ops.permissions.includes("document.verify"));

  console.log("\nA staff approve creates nothing");
  const q1 = await makeQuotation({ validityDate: new Date(Date.now() + 2 * DAY) });
  for (const [name, who] of [["bdo", bdo], ["ceo", ceo], ["ops", ops]]) {
    const r = await api("POST", `/quotations/${q1.id}/approve`, { token: who.token, body: { rowVersion: q1.rowVersion } });
    check(`${name} POST /approve is 403`, r.status === 403, `got ${r.status}`);
  }
  const after1 = await countsFor(q1.id);
  check("no shipment, task, invoice or chat channel was created", Object.values(after1).every((n) => n === 0), JSON.stringify(after1));
  check("the quotation is still sent", (await prisma.quotation.findUnique({ where: { id: q1.id } })).status === "sent");

  /* ── 2. Record the customer's yes ─────────────────────────────────────── */
  console.log("\nRecording the acceptance");
  const claim = await api("POST", `/quotations/${q1.id}/acceptance`, {
    token: bdo.token,
    body: { via: "whatsapp", note: "confirmed on WhatsApp", expiresInDays: 30 },
  });
  check("POST /acceptance — 201", claim.status === 201, `got ${claim.status} ${JSON.stringify(claim.body).slice(0, 160)}`);
  const token1 = claim.body?.data?.token;
  check("a plaintext link token is returned once", typeof token1 === "string" && token1.length >= 40);
  const q1c = await prisma.quotation.findUnique({ where: { id: q1.id } });
  check("the quotation is STILL sent — a claim is not an approval", q1c.status === "sent", `got ${q1c.status}`);
  check("the claim is recorded (who / how / when / note)",
    q1c.acceptanceClaimedById === fixtures.bdo.id && q1c.acceptanceClaimedVia === "whatsapp" && !!q1c.acceptanceClaimedAt && q1c.acceptanceClaimNote === "confirmed on WhatsApp");
  check("still nothing created", Object.values(await countsFor(q1.id)).every((n) => n === 0));
  const link1 = await prisma.approvalLink.findFirst({ where: { quotationId: q1.id }, orderBy: { createdAt: "desc" } });
  check("the link never outlives the quote's validity (30d asked, 2d granted)",
    link1 && Math.abs(new Date(link1.expiresAt) - new Date(q1.validityDate)) < 1000, `expires ${link1?.expiresAt} validity ${q1.validityDate}`);
  check("an audit row records the claim",
    !!(await prisma.auditLog.findFirst({ where: { resourceId: q1.id, action: "quotation.acceptance.claimed" } })));

  const list1 = await api("GET", "/queries", { token: bdo.token });
  const row1 = (list1.body?.data ?? []).find((r) => r.id === q1.queryId);
  check("the queries row reads 'awaiting confirmation'",
    row1?.acceptance?.claimedAt && row1?.acceptance?.link?.status === "open" && row1?.acceptance?.quotationStatus === "sent",
    JSON.stringify(row1?.acceptance ?? null));

  const reclaim = await api("POST", `/quotations/${q1.id}/acceptance`, { token: bdo.token, body: { via: "phone" } });
  check("re-recording supersedes the link", reclaim.status === 201 && reclaim.body?.data?.token !== token1);
  const dead = await api("GET", `/public/approvals/${token1}`);
  check("the superseded link is dead for the customer", dead.body?.data?.state?.status === "revoked", JSON.stringify(dead.body?.data?.state));

  const opsNote = await waitFor(() =>
    prisma.notification.findFirst({ where: { userId: fixtures.ops.id, type: "quotation.acceptance_claimed", title: { contains: q1.referenceNo } } }));
  check("Ops is told an order is EXPECTED (not created)", !!opsNote, "no quotation.acceptance_claimed notification for ops");

  /* ── 3. The signed copy ───────────────────────────────────────────────── */
  console.log("\nThe signed copy — sales uploads, Ops verifies");
  const up1 = await uploadPdf(bdo.token, { ownerType: "quotation", ownerId: q1.id, docType: "quotation_acceptance", tag: "a" });
  check("the BDO uploads the signed quotation — 201", up1.status === 201, `got ${up1.status} ${JSON.stringify(up1.body).slice(0, 160)}`);
  const doc1 = up1.body?.data;
  check("it lands unverified", doc1?.verificationStatus === "unverified");
  const list2 = await api("GET", "/queries", { token: ops.token });
  const row2 = (list2.body?.data ?? []).find((r) => r.id === q1.queryId);
  check("the queries row now carries the copy to verify",
    row2?.acceptance?.evidence?.documentId === doc1?.id && row2?.acceptance?.evidence?.verificationStatus === "unverified",
    JSON.stringify(row2?.acceptance?.evidence ?? null));

  const byBdo = await api("POST", `/documents/${doc1.id}/verification`, { token: bdo.token, body: { status: "verified" } });
  check("the BDO cannot verify it — 403", byBdo.status === 403, `got ${byBdo.status}`);
  const noNote = await api("POST", `/documents/${doc1.id}/verification`, { token: ops.token, body: { status: "rejected" } });
  check("a rejection needs a reason — 400", noNote.status === 400, `got ${noNote.status}`);
  const rej = await api("POST", `/documents/${doc1.id}/verification`, { token: ops.token, body: { status: "rejected", note: "Signature page missing" } });
  check("Ops rejects it — 200", rej.status === 200, `got ${rej.status}`);
  check("a rejection creates nothing", Object.values(await countsFor(q1.id)).every((n) => n === 0));
  const rejNote = await waitFor(() =>
    prisma.notification.findFirst({ where: { userId: fixtures.bdo.id, type: "document.rejected", title: { contains: q1.referenceNo } } }));
  check("the uploader is told why", rejNote?.body?.includes("Signature page missing"), JSON.stringify(rejNote?.body));

  const up2 = await uploadPdf(portal.token, { ownerType: "quotation", ownerId: q1.id, docType: "quotation_acceptance", tag: "b" });
  check("the portal customer can send their own signed copy — 201", up2.status === 201, `got ${up2.status} ${JSON.stringify(up2.body).slice(0, 160)}`);
  const doc2 = up2.body?.data;
  const ver = await api("POST", `/documents/${doc2.id}/verification`, { token: ops.token, body: { status: "verified" } });
  check("Ops verifies it — 200 and the shipment is created", ver.status === 200 && !!ver.body?.data?.shipmentId,
    `got ${ver.status} ${JSON.stringify(ver.body).slice(0, 200)}`);
  const ship1Id = ver.body?.data?.shipmentId;
  if (ship1Id) ids.shipments.push(ship1Id);
  const q1v = await prisma.quotation.findUnique({ where: { id: q1.id }, include: { query: true } });
  check("the quotation is approved as signed_copy", q1v.status === "approved" && q1v.approvalChannel === "signed_copy", `${q1v.status} / ${q1v.approvalChannel}`);
  check("NO internal user is credited (decidedById null)", q1v.decidedById === null, `got ${q1v.decidedById}`);
  check("the evidence document is linked to the approval", q1v.acceptanceDocumentId === doc2.id);
  check("the query is shipment_created", q1v.query.status === "shipment_created");
  const rc1 = await prisma.document.findFirst({ where: { ownerType: "shipment", ownerId: ship1Id ?? "", docType: "rate_confirmation" } });
  check("the Rate Confirmation is generated, attributed to the verifier", rc1?.uploadedById === fixtures.ops.id, JSON.stringify(rc1 && { by: rc1.uploadedById }));
  const liveLinks = await prisma.approvalLink.count({ where: { quotationId: q1.id, decidedAt: null, revokedAt: null } });
  check("the live link is revoked once the quote is approved", liveLinks === 0, `${liveLinks} live`);
  check("an audit row names the verifier and the document",
    !!(await prisma.auditLog.findFirst({ where: { resourceId: q1.id, action: "quotation.approved.signed_copy" } })));
  const again = await api("POST", `/documents/${doc2.id}/verification`, { token: ops.token, body: { status: "verified" } });
  check("verifying twice is idempotent — 200, still one shipment", again.status === 200 && (await countsFor(q1.id)).shipments === 1, `got ${again.status}`);
  const row3 = ((await api("GET", "/queries", { token: ops.token })).body?.data ?? []).find((r) => r.id === q1.queryId);
  check("the queries row reads customer-approved via signed copy",
    row3?.acceptance?.quotationStatus === "approved" && row3?.acceptance?.approvalChannel === "signed_copy", JSON.stringify(row3?.acceptance ?? null));

  const receipt = await waitFor(() =>
    prisma.notification.findFirst({ where: { userId: fixtures.portalUser.id, type: "quotation.approved" } }));
  check("the customer gets the approval receipt", !!receipt && receipt.body?.includes("If you did not approve"), JSON.stringify(receipt?.body));
  const bdoReceipt = await waitFor(() =>
    prisma.notification.findFirst({ where: { userId: fixtures.bdo.id, type: "quotation.approved", body: { contains: "signed_copy" } } }));
  check("the BDO is told the customer approved", !!bdoReceipt);

  /* ── 4. Four-eyes on the copy: the uploader never verifies their own ─── */
  console.log("\nFour-eyes on the signed copy");
  const q2 = await makeQuotation();
  const up3 = await uploadPdf(ops.token, { ownerType: "quotation", ownerId: q2.id, docType: "quotation_acceptance", tag: "c" });
  check("an ops user can upload a copy on the customer's behalf — 201", up3.status === 201, `got ${up3.status}`);
  const self = await api("POST", `/documents/${up3.body?.data?.id}/verification`, { token: ops.token, body: { status: "verified" } });
  check("…but cannot verify their own upload — 403", self.status === 403, `got ${self.status} ${self.body?.message}`);
  const colleague = await api("POST", `/documents/${up3.body?.data?.id}/verification`, { token: opsMgr.token, body: { status: "verified" } });
  check("a colleague can — 200, shipment created", colleague.status === 200 && !!colleague.body?.data?.shipmentId, `got ${colleague.status}`);
  const ship2Id = colleague.body?.data?.shipmentId;
  if (ship2Id) ids.shipments.push(ship2Id);

  /* ── 5. The pivot guard holds on every path ───────────────────────────── */
  console.log("\nAn expired quote cannot be accepted");
  const q3 = await makeQuotation({ validityDate: new Date(Date.now() - DAY) });
  const claimExpired = await api("POST", `/quotations/${q3.id}/acceptance`, { token: bdo.token, body: { via: "phone" } });
  check("recording a yes on an expired quote — 409", claimExpired.status === 409, `got ${claimExpired.status}`);
  const up4 = await uploadPdf(bdo.token, { ownerType: "quotation", ownerId: q3.id, docType: "quotation_acceptance", tag: "d" });
  const verExpired = await api("POST", `/documents/${up4.body?.data?.id}/verification`, { token: ops.token, body: { status: "verified" } });
  check("verifying its signed copy — 409", verExpired.status === 409, `got ${verExpired.status} ${verExpired.body?.message}`);
  const doc4 = await prisma.document.findUnique({ where: { id: up4.body?.data?.id ?? "" } });
  check("…and the verification rolled back with the refused pivot", doc4?.verificationStatus === "unverified", `got ${doc4?.verificationStatus}`);
  check("no shipment for the expired quote", (await countsFor(q3.id)).shipments === 0);

  /* ── 6. Order Lock is a hard gate (RULE-QT-09) ────────────────────────── */
  console.log("\nOrder Lock cannot be forced");
  await api("POST", `/shipments/${ship1Id}/claim`, { token: ops.token });
  const steps = await prisma.otdStep.findMany({ where: { shipmentId: ship1Id }, orderBy: { canonicalNo: "asc" } });
  const lock = steps.find((s) => s.stepCode === "order_lock");
  const next = steps.find((s) => s.canonicalNo > lock.canonicalNo && s.ownerDepartment === "operations");
  let ship1 = await prisma.shipment.findUnique({ where: { id: ship1Id } });
  const forced = await api("PATCH", `/otd/${ship1Id}/steps/${next.displayNo}/complete`, {
    token: ops.token, body: { rowVersion: ship1.rowVersion, forceReason: "skipping the contract gate" },
  });
  check("forcing past Order Lock with force_override — 403", forced.status === 403, `got ${forced.status} ${forced.body?.message}`);
  check("…naming the gate that cannot be overridden", /cannot be overridden/i.test(forced.body?.message ?? ""));

  const rcUp = await uploadPdf(portal.token, { ownerType: "shipment", ownerId: ship1Id, docType: "rate_confirmation", tag: "rc" });
  await api("POST", `/documents/${rcUp.body?.data?.id}/verification`, { token: ops.token, body: { status: "verified" } });
  ship1 = await prisma.shipment.findUnique({ where: { id: ship1Id } });
  const locked = await api("PATCH", `/otd/${ship1Id}/steps/${lock.displayNo}/complete`, { token: ops.token, body: { rowVersion: ship1.rowVersion } });
  check("the order locks against the verified signed RC — 200", locked.status === 200, `got ${locked.status} ${locked.body?.message}`);
  ship1 = await prisma.shipment.findUnique({ where: { id: ship1Id } });
  const afterLock = await api("PATCH", `/otd/${ship1Id}/steps/${next.displayNo}/complete`, {
    token: ops.token, body: { rowVersion: ship1.rowVersion, forceReason: "now allowed to force" },
  });
  check("after Order Lock the hard gate no longer applies", !/cannot be overridden/i.test(afterLock.body?.message ?? ""), `${afterLock.status} ${afterLock.body?.message}`);

  /* ── 7. Cancellation unwinds only before Order Lock ───────────────────── */
  console.log("\nCancelling");
  await api("POST", `/shipments/${ship2Id}/claim`, { token: opsMgr.token });
  const cancel2 = await api("POST", `/shipments/${ship2Id}/cancel`, { token: opsMgr.token, body: { reason: "customer backed out" } });
  check("cancelling before Order Lock — 200, unwound", cancel2.status === 200 && cancel2.body?.data?.unwound === true, `got ${cancel2.status} ${JSON.stringify(cancel2.body).slice(0, 160)}`);
  const q2c = await prisma.quotation.findUnique({ where: { id: q2.id }, include: { query: true } });
  check("the quotation is rejected with the reason", q2c.status === "rejected" && q2c.rejectionReason?.includes("customer backed out"), `${q2c.status} / ${q2c.rejectionReason}`);
  check("the query is back to revision_requested", q2c.query.status === "revision_requested", q2c.query.status);
  const requote = await api("POST", "/quotations", {
    token: ops.token,
    body: { queryId: q2.queryId, currency: "PKR", chargeLines: [{ description: "Ocean freight", quantity: 1, unitPrice: 140000 }] },
  });
  check("the enquiry can be re-quoted (INV-08 freed) — 201", requote.status === 201, `got ${requote.status} ${JSON.stringify(requote.body).slice(0, 160)}`);
  if (requote.body?.data?.id) ids.quotations.push({ quotationId: requote.body.data.id, queryId: q2.queryId });

  const cancel1 = await api("POST", `/shipments/${ship1Id}/cancel`, { token: ops.token, body: { reason: "after lock" } });
  check("cancelling after Order Lock — 200, NOT unwound", cancel1.status === 200 && cancel1.body?.data?.unwound === false, `got ${cancel1.status} ${JSON.stringify(cancel1.body?.data)}`);
  check("the approved quotation is left alone", (await prisma.quotation.findUnique({ where: { id: q1.id } })).status === "approved");

  /* ── 8. The lapse sweep ───────────────────────────────────────────────── */
  console.log("\nA link that expires unused");
  const q4 = await makeQuotation();
  await api("POST", `/quotations/${q4.id}/acceptance`, { token: bdo.token, body: { via: "email" } });
  await prisma.approvalLink.updateMany({ where: { quotationId: q4.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await sweepAcceptanceLapses();
  const lapsed = await prisma.outboxEvent.findFirst({ where: { eventType: "quotation.acceptance_lapsed", payload: { path: ["quotationId"], equals: q4.id } } });
  check("the sweep emits quotation.acceptance_lapsed", !!lapsed);
  await sweepAcceptanceLapses();
  const lapsedCount = await prisma.outboxEvent.count({ where: { eventType: "quotation.acceptance_lapsed", payload: { path: ["quotationId"], equals: q4.id } } });
  check("…once, not on every run", lapsedCount === 1, `${lapsedCount}`);
  const row4 = ((await api("GET", "/queries", { token: bdo.token })).body?.data ?? []).find((r) => r.id === q4.queryId);
  check("the queries row reports the link as expired", row4?.acceptance?.link?.status === "expired", JSON.stringify(row4?.acceptance?.link));
  const lapseNote = await waitFor(() =>
    prisma.notification.findFirst({ where: { userId: fixtures.bdo.id, type: "quotation.acceptance_lapsed", title: { contains: q4.referenceNo } } }));
  check("the claimer is told the customer never confirmed", !!lapseNote);
}

run()
  .catch((e) => {
    console.error("\nVerification crashed:", e);
    fail += 1;
  })
  .finally(async () => {
    try {
      // Outbox rows carrying our ids, so a later relay poll cannot notify about deleted fixtures.
      const qids = ids.quotations.map((q) => q.quotationId);
      for (const qid of qids) {
        await prisma.outboxEvent.deleteMany({ where: { payload: { path: ["quotationId"], equals: qid } } });
      }
      for (const sid of ids.shipments) {
        await prisma.outboxEvent.deleteMany({ where: { payload: { path: ["shipmentId"], equals: sid } } });
      }
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
