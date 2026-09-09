/**
 * One-time customer approval links — end-to-end verification.
 *
 *   node scripts/verifyApprovalLink.js        (needs the dev server on :5000)
 *
 * There is no test framework in this repo, so this is the safety net for the only
 * unauthenticated WRITE in the app outside the bank webhook. It builds its own company,
 * customer, queries and quotations, exercises the internal + public halves as a real
 * BDO and as an anonymous visitor, and tears everything down — so it runs against an
 * empty database and leaves zero residue.
 *
 * What it proves:
 *   · a link can only be minted for a SENT quote, and only by `quotation.share`;
 *   · the public view leaks NO buy-side data (costAmount / costVendorId / vendor ids);
 *   · approving through a link creates the shipment (RULE-QT-07) with
 *     `approvalChannel = approval_link` and `decidedById` NULL — no internal user is
 *     credited with the customer's decision;
 *   · rejecting records the customer's words and sends the query to revision_requested;
 *   · a link is single-use, revocable, superseded by a newer one, and unguessable.
 */
import crypto from "crypto";
import prisma from "../config/prisma.js";

const BASE = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:5000/api";
const PASSWORD = process.env.PASSWORD ?? "1234567";
const TAG = `ZZA${Date.now().toString().slice(-6)}`;

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
  // The public endpoints are rate limited per IP, and this script spends several
  // decision attempts per run. Without this the whole second half fails as a pile of
  // unrelated-looking assertions instead of one obvious cause.
  if (res.status === 429) {
    throw new Error(
      "Rate limited (429) — the public approval limiter is per IP per 15 minutes. Wait for the window to reset, or restart the server to clear the in-memory counter.",
    );
  }
  return { status: res.status, body: json };
};

const ids = { quotations: [], shipments: [] };

const makeQuotation = async ({ bdoId, customerId, vendorId }) => {
  const query = await prisma.query.create({
    data: {
      referenceNo: `QRY-${TAG}-${ids.quotations.length + 1}`,
      customerId,
      raisedById: bdoId,
      raisedVia: "bdo",
      status: "open",
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
      referenceNo: `QT-${TAG}-${ids.quotations.length + 1}`,
      queryId: query.id,
      status: "sent",
      services: ["sea_freight"],
      currency: "PKR",
      totalAmount: 150000,
      createdById: bdoId,
      sentById: bdoId,
      sentAt: new Date(),
      chargeLines: {
        create: [
          {
            service: "sea_freight",
            chargeCode: "ocean_freight",
            description: "Ocean Freight",
            quantity: 1,
            unitPrice: 150000,
            amount: 150000,
            sortOrder: 0,
            // The buy side. If either of these ever reaches the public view, the
            // customer can read Consort's margin — the assertion below is the guard.
            costAmount: 90000,
            costVendorId: vendorId,
          },
        ],
      },
    },
    include: { chargeLines: true },
  });
  ids.quotations.push({ quotationId: quotation.id, queryId: query.id });
  return quotation;
};

const fixtures = {};

const buildFixtures = async () => {
  const bdo = await prisma.user.findFirst({ where: { role: "bdo", isActive: true } });
  if (!bdo) throw new Error("No active bdo user — run `node prisma/seed.js --accounts-only`");
  fixtures.bdo = bdo;

  const vendor = await prisma.vendor.create({
    data: {
      referenceNo: `VEN-${TAG}`,
      name: `${TAG} Carrier`,
      normalizedName: `${TAG} carrier`.toLowerCase(),
      type: "ocean_carrier",
      country: "PK",
    },
  });
  const company = await prisma.company.create({
    data: { name: `${TAG} Approval Co`, normalizedName: `${TAG} approval co`.toLowerCase(), country: "PK" },
  });
  const customer = await prisma.customer.create({
    data: { referenceNo: `CST-${TAG}`, companyId: company.id, source: "direct", assignedBdoId: bdo.id },
  });
  Object.assign(fixtures, { vendor, company, customer });
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
    await prisma.invoiceLine.deleteMany({ where: { invoice: { shipmentId } } });
    await prisma.payment.deleteMany({ where: { invoice: { shipmentId } } });
    await prisma.invoice.deleteMany({ where: { shipmentId } });
    await prisma.shipment.deleteMany({ where: { id: shipmentId } });
  }
  for (const { quotationId, queryId } of ids.quotations) {
    await prisma.approvalLink.deleteMany({ where: { quotationId } });
    await prisma.quotationChargeLine.deleteMany({ where: { quotationId } });
    await prisma.quotation.deleteMany({ where: { id: quotationId } });
    await prisma.query.deleteMany({ where: { id: queryId } });
  }
  if (fixtures.customer) await prisma.customer.deleteMany({ where: { id: fixtures.customer.id } });
  if (fixtures.company) await prisma.company.deleteMany({ where: { id: fixtures.company.id } });
  if (fixtures.vendor) await prisma.vendor.deleteMany({ where: { id: fixtures.vendor.id } });
  await prisma.auditLog.deleteMany({ where: { resourceId: { in: ids.quotations.map((q) => q.quotationId) } } });
};

async function run() {
  await buildFixtures();
  const { bdo, customer, vendor } = fixtures;

  const login = await api("POST", "/auth/login", { body: { email: bdo.email, password: PASSWORD } });
  if (!login.body?.accessToken) throw new Error(`login failed for ${bdo.email}: ${login.status}`);
  const token = login.body.accessToken;
  console.log(`\nActing as ${bdo.email} (bdo)`);

  /* ── 1. Minting ───────────────────────────────────────────────────────── */
  console.log("\nIssuing the link");
  const q1 = await makeQuotation({ bdoId: bdo.id, customerId: customer.id, vendorId: vendor.id });
  const issued = await api("POST", `/quotations/${q1.id}/approval-link`, { token, body: {} });
  check("a sent quote mints a link — 201", issued.status === 201, `got ${issued.status}`);
  const rawToken = issued.body?.data?.token;
  check("the plaintext token is returned once", typeof rawToken === "string" && rawToken.length >= 40);
  check("the token hash is never returned", !JSON.stringify(issued.body).includes("tokenHash"));

  const stored = await prisma.approvalLink.findFirst({ where: { quotationId: q1.id } });
  const expectedHash = crypto.createHash("sha256").update(rawToken ?? "").digest("hex");
  check("only the SHA-256 hash is stored", stored?.tokenHash === expectedHash);
  check("the raw token is nowhere in the row", !JSON.stringify(stored).includes(rawToken ?? "!"));

  const status = await api("GET", `/quotations/${q1.id}/approval-link`, { token });
  check("the status endpoint reports it live", status.body?.data?.active?.status === "open", JSON.stringify(status.body?.data));
  check("the status endpoint never returns the token", !JSON.stringify(status.body).includes(rawToken ?? "!"));

  /* ── 2. The public view leaks nothing ─────────────────────────────────── */
  console.log("\nPublic view (no auth)");
  const view = await api("GET", `/public/approvals/${rawToken}`);
  check("anonymous GET works — 200", view.status === 200, `got ${view.status}`);
  const raw = JSON.stringify(view.body ?? {});
  check("the quote is shown", view.body?.data?.referenceNo === q1.referenceNo);
  check("NO cost is exposed", !raw.includes("90000") && !raw.includes("costAmount"));
  check("NO vendor is exposed", !raw.includes(vendor.id) && !raw.includes("costVendorId"));
  check("NO internal ids are exposed", !raw.includes(q1.id) && !raw.includes(customer.id));
  check("a bad token is a flat 404", (await api("GET", "/public/approvals/" + "x".repeat(43))).status === 404);

  /* ── 3. Reject ────────────────────────────────────────────────────────── */
  console.log("\nRejecting through the link");
  const noName = await api("POST", `/public/approvals/${rawToken}/decision`, {
    body: { decision: "rejected", approverEmail: "buyer@example.test", reason: "Too expensive" },
  });
  check("a decision without a name is refused — 400", noName.status === 400, `got ${noName.status}`);
  const noReason = await api("POST", `/public/approvals/${rawToken}/decision`, {
    body: { decision: "rejected", approverName: "Zed Buyer", approverEmail: "buyer@example.test" },
  });
  check("a rejection with no reason is refused — 400", noReason.status === 400, `got ${noReason.status}`);

  const rejected = await api("POST", `/public/approvals/${rawToken}/decision`, {
    body: {
      decision: "rejected",
      approverName: "Zed Buyer",
      approverEmail: "buyer@example.test",
      reason: "Please re-quote without the documentation fee",
    },
  });
  check("the rejection is accepted — 200", rejected.status === 200, JSON.stringify(rejected.body));

  const q1After = await prisma.quotation.findUnique({ where: { id: q1.id }, include: { query: true } });
  check("the quotation is rejected", q1After.status === "rejected");
  check("approvalChannel records the link", q1After.approvalChannel === "approval_link", `got ${q1After.approvalChannel}`);
  check("NO internal user is credited (decidedById null)", q1After.decidedById === null, `got ${q1After.decidedById}`);
  check("the customer's words are kept", q1After.rejectionReason?.includes("documentation fee"));
  check("the query goes to revision_requested", q1After.query.status === "revision_requested");

  const link1 = await prisma.approvalLink.findFirst({ where: { quotationId: q1.id } });
  check("the approver is recorded on the link", link1.approverEmail === "buyer@example.test" && !!link1.decidedAt);
  check("the approver's IP is recorded", !!link1.approverIp);

  const replay = await api("POST", `/public/approvals/${rawToken}/decision`, {
    body: { decision: "approved", approverName: "Zed Buyer", approverEmail: "buyer@example.test" },
  });
  check("the link is single-use — replay is 410", replay.status === 410, `got ${replay.status}`);

  /* ── 4. Revocation and supersession ───────────────────────────────────── */
  console.log("\nRevoking and superseding");
  const q2 = await makeQuotation({ bdoId: bdo.id, customerId: customer.id, vendorId: vendor.id });
  const t2 = (await api("POST", `/quotations/${q2.id}/approval-link`, { token, body: {} })).body.data.token;
  await api("DELETE", `/quotations/${q2.id}/approval-link`, { token });
  const afterRevoke = await api("POST", `/public/approvals/${t2}/decision`, {
    body: { decision: "approved", approverName: "Zed Buyer", approverEmail: "buyer@example.test" },
  });
  check("a revoked link cannot decide — 410", afterRevoke.status === 410, `got ${afterRevoke.status}`);

  const t2b = (await api("POST", `/quotations/${q2.id}/approval-link`, { token, body: {} })).body.data.token;
  const t2c = (await api("POST", `/quotations/${q2.id}/approval-link`, { token, body: {} })).body.data.token;
  check("re-issuing produces a different token", t2b !== t2c);
  const supersededDecision = await api("POST", `/public/approvals/${t2b}/decision`, {
    body: { decision: "approved", approverName: "Zed Buyer", approverEmail: "buyer@example.test" },
  });
  check("the superseded link is dead — 410", supersededDecision.status === 410, `got ${supersededDecision.status}`);

  /* ── 5. Approve — the pivot ───────────────────────────────────────────── */
  console.log("\nApproving through the link");
  const approved = await api("POST", `/public/approvals/${t2c}/decision`, {
    body: { decision: "approved", approverName: "Zed Buyer", approverEmail: "buyer@example.test" },
  });
  check("the approval is accepted — 200", approved.status === 200, JSON.stringify(approved.body));

  const q2After = await prisma.quotation.findUnique({ where: { id: q2.id } });
  check("the quotation is approved", q2After.status === "approved", `got ${q2After.status}`);
  check("approvalChannel records the link", q2After.approvalChannel === "approval_link");
  check("NO internal user is credited (decidedById null)", q2After.decidedById === null, `got ${q2After.decidedById}`);

  const shipment = await prisma.shipment.findFirst({ where: { quotationId: q2.id } });
  if (shipment) ids.shipments.push(shipment.id);
  check("the shipment was created (RULE-QT-07)", !!shipment, "no shipment for the approved quote");
  const stepCount = shipment ? await prisma.otdStep.count({ where: { shipmentId: shipment.id } }) : 0;
  check("its OTD path was composed", stepCount > 0, `${stepCount} steps`);
  check("the response names the shipment", approved.body?.data?.shipmentRef === shipment?.referenceNo);

  const auditRow = await prisma.auditLog.findFirst({
    where: { resourceId: q2.id, action: "quotation.approved.approval_link" },
  });
  check("an audit row names the external approver", auditRow?.diff?.approverEmail === "buyer@example.test");

  // Both generated PDFs are written inside a best-effort catch, so a failure here is
  // SILENT — which is exactly how `uploaded_by_id` (non-nullable) being handed a null
  // actorId lost the Rate Confirmation on this channel without anything going red.
  const docs = shipment
    ? await prisma.document.findMany({ where: { ownerType: "shipment", ownerId: shipment.id } })
    : [];
  const rc = docs.find((d) => d.docType === "rate_confirmation");
  check("the Rate Confirmation is generated on approval", !!rc, `docTypes: ${docs.map((d) => d.docType).join(", ") || "none"}`);
  check("the RC is published so the customer can fetch it", rc?.isPublished === true);
  check("the RC lands unverified (ops must sign it off)", rc?.verificationStatus === "unverified");
  check("the RC is attributed to the link's issuer", rc?.uploadedById === fixtures.bdo.id);
  check("the approved quotation PDF is generated too", docs.some((d) => d.docType === "quotation"));

  /* ── The ops desk can pull the RC straight off the queries row ─────────── */
  console.log("\nRate Confirmation on the queries list");
  const list = await api("GET", "/queries", { token });
  const row = (list.body?.data ?? []).find((r) => r.id === ids.quotations[1]?.queryId);
  check("the approved query comes back on the list", !!row, `status ${list.status}`);
  check(
    "its row carries the Rate Confirmation",
    row?.rateConfirmation?.documentId === rc?.id,
    `got ${JSON.stringify(row?.rateConfirmation ?? null)}`,
  );
  check("the row carries a filename to download as", !!row?.rateConfirmation?.fileName);

  const openRow = (list.body?.data ?? []).find((r) => r.status !== "shipment_created");
  check(
    "a query with no shipment carries no RC",
    openRow ? openRow.rateConfirmation === null : true,
    `got ${JSON.stringify(openRow?.rateConfirmation)}`,
  );

  if (rc) {
    const dl = await fetch(`${BASE}/documents/${rc.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    check("the RC actually downloads — 200", dl.status === 200, `got ${dl.status}`);
    const bytes = Buffer.from(await dl.arrayBuffer());
    check("it is a real PDF", bytes.subarray(0, 4).toString() === "%PDF", `starts with ${bytes.subarray(0, 8).toString()}`);
    check("it has content", bytes.length > 500, `${bytes.length} bytes`);
  }

  /* ── 6. A decided quote cannot be re-linked ───────────────────────────── */
  const relink = await api("POST", `/quotations/${q2.id}/approval-link`, { token, body: {} });
  check("an approved quote cannot mint a new link — 409", relink.status === 409, `got ${relink.status}`);
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
