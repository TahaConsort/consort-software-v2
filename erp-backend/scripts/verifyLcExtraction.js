/**
 * End-to-end check of the LC PDF → query path against a RUNNING local server.
 *
 *   node scripts/verifyLcExtraction.js
 *
 * Needs the demo referral: run `node scripts/seedDemoLcReferral.js` first.
 *
 * Exercises: ops_exec reads the attached advice → the SWIFT fields parse → applying
 * them fills the referral's empty columns → converting mints a customer + query
 * carrying the LC's lane/commodity → ops_manager and ops_exec can both draft a
 * quotation on that query.
 *
 * Converts a COPY, not the seeded referral: it clones the demo row (and its document
 * link) so the inbox row you are testing with stays in `received`.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../config/prisma.js";
import { UPLOAD_ROOT } from "../modules/document/document.service.js";

const BASE = process.env.BASE ?? "http://localhost:5000";
const PASSWORD = process.env.PASSWORD ?? "1234567";
const CLONE_KEY = "zz:verify:lc:clone";
const CLONE_COMPANY = "ZZ Verify LC Importer Ltd";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const login = async (email) => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json?.accessToken) throw new Error(`Login failed for ${email} — is the server running?`);
  return json;
};

const call = async (token, method, path, body) => {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
};

const cleanup = async () => {
  const clone = await prisma.bankLcReferral.findUnique({ where: { idempotencyKey: CLONE_KEY } });
  if (!clone) return;
  // Drop what converting the clone created. Order matters: these FKs are RESTRICT,
  // so every child goes before its parent.
  if (clone.convertedQueryId) {
    const quotes = await prisma.quotation.findMany({
      where: { queryId: clone.convertedQueryId }, select: { id: true },
    });
    const quoteIds = quotes.map((q) => q.id);
    if (quoteIds.length) {
      await prisma.quotationChargeLine.deleteMany({ where: { quotationId: { in: quoteIds } } });
      await prisma.quotation.deleteMany({ where: { id: { in: quoteIds } } });
    }
    const qDocs = await prisma.document.findMany({ where: { ownerType: "query", ownerId: clone.convertedQueryId } });
    for (const d of qDocs) {
      try { fs.unlinkSync(path.join(UPLOAD_ROOT, d.storageKey)); } catch { /* already gone */ }
    }
    await prisma.document.deleteMany({ where: { ownerType: "query", ownerId: clone.convertedQueryId } });
    await prisma.query.deleteMany({ where: { id: clone.convertedQueryId } });
  }
  if (clone.convertedLeadId) {
    await prisma.leadStatusHistory.deleteMany({ where: { leadId: clone.convertedLeadId } });
    await prisma.lead.deleteMany({ where: { id: clone.convertedLeadId } });
  }
  // The clone materialises its own company/customer/contact (CLONE_COMPANY) — leaving
  // those behind would make the next run reuse a half-cleaned customer.
  if (clone.convertedCustomerId) await prisma.customer.deleteMany({ where: { id: clone.convertedCustomerId } });
  const cloneCo = await prisma.company.findFirst({ where: { name: CLONE_COMPANY } });
  if (cloneCo) {
    await prisma.contact.deleteMany({ where: { companyId: cloneCo.id } });
    await prisma.company.deleteMany({ where: { id: cloneCo.id } });
  }
  // The clone got its OWN copy of the PDF (storageKey is unique) — take it with us.
  const docs = await prisma.document.findMany({ where: { ownerType: "lc_referral", ownerId: clone.id } });
  for (const d of docs) {
    try { fs.unlinkSync(path.join(UPLOAD_ROOT, d.storageKey)); } catch { /* already gone */ }
  }
  await prisma.document.deleteMany({ where: { ownerType: "lc_referral", ownerId: clone.id } });
  await prisma.bankLcReferral.delete({ where: { id: clone.id } });
};

async function run() {
  await cleanup();

  const seeded = await prisma.bankLcReferral.findUnique({ where: { idempotencyKey: "demo:lc:swift-mt710-sample" } });
  if (!seeded) throw new Error("Demo referral missing — run `node scripts/seedDemoLcReferral.js` first");
  const seededDoc = await prisma.document.findFirst({
    where: { ownerType: "lc_referral", ownerId: seeded.id, deletedAt: null },
  });
  if (!seededDoc) throw new Error("Demo referral has no LC document attached");
  // Status is not asserted: whoever is testing may well have converted it in the UI,
  // and a verify run has no business failing because the demo was used.
  check("demo referral exists with its LC attached", !!seeded.id, `${seeded.referenceNo} (${seeded.status})`);

  // A clone that shares the same PDF bytes, so converting it leaves the demo alone.
  const clone = await prisma.bankLcReferral.create({
    data: {
      referenceNo: `${seeded.referenceNo}-ZZ`,
      idempotencyKey: CLONE_KEY,
      lcNumber: seeded.lcNumber,
      bankName: seeded.bankName,
      // A company name of its own, so materialising this clone never touches the real
      // customer the demo referral creates when someone converts it in the UI. Without
      // it both conversions dedupe onto one company and the run corrupts live data.
      companyName: CLONE_COMPANY,
      rawPayload: { source: "verify-clone" },
      status: "received",
    },
  });
  // storageKey is unique, so the clone gets its own copy of the same bytes.
  const cloneKey = `${crypto.randomUUID()}.pdf`;
  fs.copyFileSync(path.join(UPLOAD_ROOT, seededDoc.storageKey), path.join(UPLOAD_ROOT, cloneKey));
  await prisma.document.create({
    data: {
      ownerType: "lc_referral",
      ownerId: clone.id,
      fileName: seededDoc.fileName,
      mimeType: seededDoc.mimeType,
      sizeBytes: seededDoc.sizeBytes,
      checksum: seededDoc.checksum,
      storageKey: cloneKey,
      docType: "lc",
      scanStatus: "clean",
      uploadedById: seededDoc.uploadedById,
    },
  });

  const exec = await login("ops.exec@consort.test");
  const mgr = await login("ops.manager@consort.test");
  check("ops_exec holds lc.read + lc.convert",
    exec.permissions?.includes("lc.read") && exec.permissions?.includes("lc.convert"));
  check("ops_exec + ops_manager hold quotation.create",
    exec.permissions?.includes("quotation.create") && mgr.permissions?.includes("quotation.create"));

  // ── read the advice ──
  const ex = await call(exec.accessToken, "GET", `/lc-referrals/${clone.id}/extract`);
  const f = ex.json?.data?.fields;
  check("GET /extract reads the PDF", ex.status === 200 && !!f, `${f?.tagCount} SWIFT tags`);
  check("LC number parsed", f?.lcNumber === "LC1111112600042", f?.lcNumber);
  check("amount + currency parsed", f?.currency === "USD" && Number(f?.amount) === 300000, `${f?.currency} ${f?.amount}`);
  check("applicant parsed in full", f?.applicantName === "LINYI TRADE CITY NEW COMMERCIAL DEVELOPMENT CO.,LTD", f?.applicantName);
  check("beneficiary parsed", f?.beneficiaryName === "NATIONAL STEEL COMPLEX LIMITED", f?.beneficiaryName);
  check("commodity parsed", f?.commodity === "IRON ORE PELLETS", `${f?.commodity} · ${f?.quantity}`);
  check("incoterm parsed", f?.incoterm === "CFR", f?.priceTerm);
  check("lane parsed", /KARACHI/.test(f?.originPort ?? "") && /QINGDAO/.test(f?.destinationPort ?? ""),
    `${f?.originPort} → ${f?.destinationPort}`);
  check("loading port resolved to a seeded code", ex.json?.data?.resolved?.originPortCode === "PKKHI",
    ex.json?.data?.resolved?.originPortCode);
  check("unknown discharge port reported, not invented", ex.json?.data?.resolved?.destinationPortCode === null,
    "Qingdao is not in the ports table");
  check("raw text returned for review", (ex.json?.data?.text?.length ?? 0) > 1000, `${ex.json?.data?.text?.length} chars`);

  // ── apply to the referral ──
  const applied = await call(exec.accessToken, "POST", `/lc-referrals/${clone.id}/extract/apply`, {});
  const r = applied.json?.data;
  check("POST /extract/apply fills the empty columns", applied.status === 200
    && r?.applicantName === f.applicantName && Number(r?.amount) === 300000 && r?.commodity === "IRON ORE PELLETS",
    applied.json?.message);
  check("apply did NOT overwrite the bank's own value",
    r?.bankName === seeded.bankName, r?.bankName);

  // ── convert to a query ──
  const conv = await call(exec.accessToken, "POST", `/lc-referrals/${clone.id}/convert`, {});
  const queryId = conv.json?.data?.queryId;
  check("POST /convert mints a customer + query", conv.status === 201 && !!queryId, conv.json?.message);

  const query = queryId ? await prisma.query.findUnique({ where: { id: queryId } }) : null;
  // The rich Query model is gone: cargo, ports, incoterm and weight are no longer
  // columns on a query. What the LC said is preserved on the lead history (checked
  // below) and in the attached PDF; the lane survives as the pickup address.
  check("query carries the lane the LC named", /KARACHI|PKKHI/i.test(query?.pickupAddress ?? ""),
    query?.pickupAddress);
  check("lc_finance is implied on a bank-LC query", (query?.services ?? []).includes("lc_finance"),
    (query?.services ?? []).join(", "));

  // Ops converts, Sales owns: the conversion must leave the customer in the claim pool
  // so a BDO can take it and decide on the quote (2026-09-08).
  const convCustomer = await prisma.customer.findUnique({
    where: { id: (await prisma.bankLcReferral.findUnique({ where: { id: clone.id } }))?.convertedCustomerId },
  });
  check("converted customer lands in the unclaimed pool", convCustomer?.assignedBdoId === null,
    `assignedBdoId=${convCustomer?.assignedBdoId}`);
  check("the query is raised by the converting ops user", query?.raisedById === exec.user?.id,
    query?.raisedById);

  // The LC's own words are kept on the lead's status history — the Query model has no
  // free-text field, and losing the bank's phrasing entirely is worse than the detour.
  const hist = await prisma.leadStatusHistory.findFirst({
    where: { leadId: (await prisma.bankLcReferral.findUnique({ where: { id: clone.id } }))?.convertedLeadId },
  });
  check("LC summary retained verbatim on the lead history",
    /IRON ORE PELLETS/.test(hist?.notes ?? "") && /300000/.test(hist?.notes ?? ""),
    (hist?.notes ?? "").split("\n")[1]);


  const queryDoc = await prisma.document.findFirst({ where: { ownerType: "query", ownerId: queryId, docType: "lc" } });
  check("the LC PDF is attached to the query", !!queryDoc, queryDoc?.fileName);

  // The lcDetails snapshot is gone with the rich Query model — the extracted fields
  // stay on the BankLcReferral row, and the LC PDF is attached to the query above.

  // ── both ops roles can quote it ──
  for (const [role, session] of [["ops_exec", exec], ["ops_manager", mgr]]) {
    const seen = await call(session.accessToken, "GET", `/queries/${queryId}`);
    check(`${role} can open the converted query`, seen.status === 200, `HTTP ${seen.status}`);
  }
  const quotePayload = {
    queryId,
    currency: "USD",
    chargeLines: [
      { service: "sea_freight", description: "Ocean freight Karachi → Qingdao", quantity: 1, unitPrice: 2400 },
      { service: "lc_finance", description: "LC handling & document negotiation", quantity: 1, unitPrice: 350 },
    ],
  };
  const firstQuote = await call(exec.accessToken, "POST", "/quotations", quotePayload);
  check("ops_exec can draft a quotation on it", [200, 201].includes(firstQuote.status),
    firstQuote.json?.data?.referenceNo ?? firstQuote.json?.message);

  // ops_manager is equally permitted, but only ONE live quotation may exist per query
  // (INV-07). A 409 here proves the invariant holds; a 403 would mean the role is
  // wrong. Distinguishing them is the whole point of asserting the status code.
  const secondQuote = await call(mgr.accessToken, "POST", "/quotations", quotePayload);
  check("ops_manager is permitted too — blocked only by INV-07, not by role",
    secondQuote.status === 409, `HTTP ${secondQuote.status}: ${secondQuote.json?.message}`);

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log(`✗ failing: ${failed.map((x) => x.name).join(", ")}`);
    process.exitCode = 1;
  }
}

run()
  .catch((err) => {
    console.error("✗ run failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
