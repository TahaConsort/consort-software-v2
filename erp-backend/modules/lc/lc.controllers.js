import crypto from "crypto";
import fs from "fs";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { materializeCustomerAndQuery } from "../intake/intake.service.js";
import { absPathFor } from "../document/document.service.js";
import { readLcPdf, parseQuantityKg } from "./lc.extract.js";
import { webhookLcSchema } from "./lc.validation.js";

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * Bank LC intake (CRM_MASTER §5.21, WORKFLOW §2c/§8b).
 *   · receiveWebhook — PUBLIC, shared-secret authed, idempotent inbound LC.
 *   · inbox — ops_exec/Operations list, review, convert or reject a referral.
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

const serialize = (r) => ({
  ...r,
  amount: r.amount != null ? Number(r.amount) : null,
});

/* ── POST /api/webhooks/bank/lc ── (PUBLIC — shared secret, idempotent) */
export const receiveWebhook = catchAsync(async (req, res, next) => {
  const secret = process.env.LC_WEBHOOK_SECRET;
  if (!secret) {
    return next(new AppError("LC webhook is not configured", 503));
  }
  if (req.headers["x-webhook-secret"] !== secret) {
    return next(new AppError("Invalid webhook signature", 401));
  }

  const parsed = webhookLcSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new AppError(`Invalid LC payload: ${parsed.error.issues.map((i) => i.message).join("; ")}`, 400));
  }
  const b = parsed.data;

  // Idempotency: prefer the bank's own reference; else a hash of the LC identity.
  const idempotencyKey =
    b.idempotencyKey ||
    b.messageRef ||
    crypto.createHash("sha256").update(`${b.lcNumber}|${b.bankRef ?? ""}|${b.amount ?? ""}`).digest("hex");

  // Replay → return the existing referral (idempotent, never duplicates).
  const existing = await prisma.bankLcReferral.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return res.status(202).json({ success: true, message: "Already received", data: { referenceNo: existing.referenceNo } });
  }

  let referral;
  try {
    referral = await prisma.$transaction(async (tx) => {
      const referenceNo = await allocateRef(tx, "lc_referral");
      const created = await tx.bankLcReferral.create({
        data: {
          referenceNo,
          idempotencyKey,
          lcNumber: b.lcNumber,
          bankName: b.bankName ?? null,
          bankRef: b.bankRef ?? null,
          applicantName: b.applicantName ?? null,
          applicantEmail: b.applicantEmail ?? null,
          applicantPhone: b.applicantPhone ?? null,
          companyName: b.companyName ?? null,
          beneficiaryName: b.beneficiaryName ?? null,
          amount: b.amount ?? null,
          currency: b.currency ?? null,
          originPort: b.originPort ?? null,
          destinationPort: b.destinationPort ?? null,
          commodity: b.commodity ?? null,
          incoterm: b.incoterm ?? null,
          issueDate: b.issueDate ?? null,
          expiryDate: b.expiryDate ?? null,
          rawPayload: req.body,
        },
      });
      await emitEvent(tx, "lc.received", {
        referralId: created.id,
        referenceNo,
        lcNumber: created.lcNumber,
        applicantName: created.applicantName,
      });
      return created;
    });
  } catch (err) {
    // Concurrent duplicate landed first → treat as already received.
    if (err?.code === "P2002") {
      const dup = await prisma.bankLcReferral.findUnique({ where: { idempotencyKey } });
      return res.status(202).json({ success: true, message: "Already received", data: { referenceNo: dup?.referenceNo } });
    }
    throw err;
  }

  res.status(202).json({
    success: true,
    message: "LC received",
    data: { referenceNo: referral.referenceNo },
  });
});

// ── reading the attached LC advice ────────────────────────────────────────────

/** The LC PDF attached to a referral — the newest, if the bank sent an amendment. */
const lcDocumentFor = async (referralId) =>
  prisma.document.findFirst({
    where: { ownerType: "lc_referral", ownerId: referralId, deletedAt: null, mimeType: "application/pdf" },
    orderBy: { createdAt: "desc" },
  });

/**
 * A port on an LC is prose — "KARACHI PORT/QASIM PORT,PAKISTAN" — while a query
 * needs a UN/LOCODE we actually have. Match the seeded port names against the text
 * and return the code, or null. Null is a normal outcome, not a failure: the raw
 * text is kept either way so nothing the bank wrote is lost.
 */
const resolvePortCode = (text, ports) => {
  if (!text) return null;
  const haystack = text.toUpperCase();
  const hit = ports.find((p) => new RegExp(`\\b${p.name.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack));
  return hit?.code ?? null;
};

/** Parse the attached PDF into LC fields + resolved port codes. */
const readAttachedLc = async (referralId) => {
  const doc = await lcDocumentFor(referralId);
  if (!doc) return null;
  const abs = absPathFor(doc.storageKey);
  if (!fs.existsSync(abs)) return null;

  const { fields, text, pageCount } = readLcPdf(fs.readFileSync(abs));
  const ports = await prisma.port.findMany({ select: { code: true, name: true } });
  return {
    document: { id: doc.id, fileName: doc.fileName, sizeBytes: doc.sizeBytes },
    fields,
    pageCount,
    text,
    resolved: {
      originPortCode: resolvePortCode(fields.originPort, ports),
      destinationPortCode: resolvePortCode(fields.destinationPort, ports),
    },
  };
};

/* ── GET /api/lc-referrals/:id/extract ── (read-only preview of the PDF's fields) */
export const extractReferral = catchAsync(async (req, res, next) => {
  const referral = await prisma.bankLcReferral.findUnique({ where: { id: req.params.id } });
  if (!referral) return next(new AppError("LC referral not found", 404));

  const read = await readAttachedLc(referral.id);
  if (!read) return next(new AppError("No LC document is attached to this referral", 404));
  if (!read.fields.tagCount) {
    return next(new AppError("No text could be read from this PDF — it looks like a scan", 422));
  }
  res.json({ success: true, data: read });
});

/* ── POST /api/lc-referrals/:id/extract/apply ── (write the PDF's fields onto the referral) */
/**
 * Deliberately fills only what is EMPTY unless `overwrite` is asked for: a value the
 * bank posted through the webhook is structured data they stand behind, and a text
 * layer read out of a printout should not silently replace it.
 */
export const applyExtraction = catchAsync(async (req, res, next) => {
  const referral = await prisma.bankLcReferral.findUnique({ where: { id: req.params.id } });
  if (!referral) return next(new AppError("LC referral not found", 404));
  if (["converted", "rejected"].includes(referral.status)) {
    return next(new AppError(`A ${referral.status} referral cannot be edited`, 409));
  }

  const read = await readAttachedLc(referral.id);
  if (!read) return next(new AppError("No LC document is attached to this referral", 404));

  const f = read.fields;
  const overwrite = req.body?.overwrite === true;
  const take = (current, extracted) => (extracted != null && (overwrite || current == null) ? extracted : undefined);

  const data = {
    lcNumber: f.lcNumber && (overwrite || !referral.lcNumber) ? f.lcNumber : undefined,
    bankName: take(referral.bankName, f.issuingBankName),
    bankRef: take(referral.bankRef, f.senderRef),
    applicantName: take(referral.applicantName, f.applicantName),
    companyName: take(referral.companyName, f.applicantName),
    beneficiaryName: take(referral.beneficiaryName, f.beneficiaryName),
    amount: take(referral.amount, f.amount),
    currency: take(referral.currency, f.currency),
    originPort: take(referral.originPort, f.originPort),
    destinationPort: take(referral.destinationPort, f.destinationPort),
    commodity: take(referral.commodity, f.commodity),
    incoterm: take(referral.incoterm, f.incoterm),
    issueDate: take(referral.issueDate, f.issueDate),
    expiryDate: take(referral.expiryDate, f.expiryDate),
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];

  const updated = await prisma.bankLcReferral.update({ where: { id: referral.id }, data });
  res.json({
    success: true,
    message: `Read ${Object.keys(data).length} field(s) from the LC`,
    data: serialize(updated),
  });
});

/* ── GET /api/lc-referrals ── */
export const listReferrals = catchAsync(async (req, res) => {
  const { status } = req.query;
  const referrals = await prisma.bankLcReferral.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
  });
  res.json({ success: true, data: referrals.map(serialize) });
});

/* ── GET /api/lc-referrals/:id ── */
export const getReferral = catchAsync(async (req, res, next) => {
  const referral = await prisma.bankLcReferral.findUnique({ where: { id: req.params.id } });
  if (!referral) return next(new AppError("LC referral not found", 404));
  res.json({ success: true, data: serialize(referral) });
});

/* ── PATCH /api/lc-referrals/:id/status ── (mark reviewing) */
export const updateReferralStatus = catchAsync(async (req, res, next) => {
  const referral = await prisma.bankLcReferral.findUnique({ where: { id: req.params.id } });
  if (!referral) return next(new AppError("LC referral not found", 404));
  if (["converted", "rejected"].includes(referral.status)) {
    return next(new AppError(`A ${referral.status} referral cannot change status`, 409));
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.bankLcReferral.update({
      where: { id: referral.id },
      data: { status: req.body.status, reviewedById: req.user.id },
    });
    await emitEvent(tx, "lc.updated", { referralId: row.id, referenceNo: row.referenceNo, status: row.status });
    return row;
  });
  res.json({ success: true, message: "Referral updated", data: serialize(updated) });
});

/* ── POST /api/lc-referrals/:id/reject ── */
export const rejectReferral = catchAsync(async (req, res, next) => {
  const referral = await prisma.bankLcReferral.findUnique({ where: { id: req.params.id } });
  if (!referral) return next(new AppError("LC referral not found", 404));
  if (["converted", "rejected"].includes(referral.status)) {
    return next(new AppError(`A ${referral.status} referral cannot be rejected`, 409));
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.bankLcReferral.update({
      where: { id: referral.id },
      data: { status: "rejected", reviewedById: req.user.id, rejectReason: req.body.reason },
    });
    await emitEvent(tx, "lc.updated", { referralId: row.id, referenceNo: row.referenceNo, status: "rejected" });
    return row;
  });
  res.json({ success: true, message: "Referral rejected", data: serialize(updated) });
});

/* ── POST /api/lc-referrals/:id/convert ── (→ customer(bank_lc) + query) */
export const convertReferral = catchAsync(async (req, res, next) => {
  const referral = await prisma.bankLcReferral.findUnique({ where: { id: req.params.id } });
  if (!referral) return next(new AppError("LC referral not found", 404));
  if (referral.status === "converted") {
    return next(new AppError("This referral has already been converted", 409));
  }
  if (referral.status === "rejected") {
    return next(new AppError("A rejected referral cannot be converted", 409));
  }

  const ownerId = req.body.ownerId || req.user.id;

  // Read the attached advice and let it fill whatever the referral is missing. This is
  // the point of the whole feature: an LC that arrived as a PDF has no structured
  // columns, so without this the query would be born with no lane, no commodity and no
  // value — and the ops user quoting it would have to open the PDF and retype it.
  // Referral columns still win where they exist (see applyExtraction).
  const read = await readAttachedLc(referral.id).catch(() => null);
  const f = read?.fields ?? {};
  const pick = (a, b) => (a != null && a !== "" ? a : b ?? null);

  // A query's port must be a UN/LOCODE we hold. The referral column can carry either
  // — a code from the bank's webhook, or the LC's prose once the operator applied the
  // extraction — so resolve whatever is there instead of trusting its shape. Passing
  // "KARACHI PORT/QASIM PORT,PAKISTAN" straight through is how the lane silently
  // became empty: sanitizeRefs drops anything that is not a real code.
  const ports = await prisma.port.findMany({ select: { code: true, name: true } });
  const toCode = (v) => {
    if (!v) return null;
    return ports.find((p) => p.code === v)?.code ?? resolvePortCode(v, ports);
  };
  const originPort = toCode(referral.originPort) ?? toCode(f.originPort);
  const destinationPort = toCode(referral.destinationPort) ?? toCode(f.destinationPort);

  // Applicant is the buyer/importer; fall back to beneficiary or company name.
  const contactName = pick(referral.applicantName, f.applicantName)
    || pick(referral.beneficiaryName, f.beneficiaryName) || referral.companyName || "LC Applicant";
  // lc_finance is always implied for the bank_lc channel (intake.service adds it).
  const services = req.body.services?.length ? req.body.services : ["sea_freight", "lc_finance"];

  // What the LC itself says, kept verbatim on the query so the person quoting reads
  // the bank's words rather than a lossy column mapping.
  const lcSummary = [
    `Converted from bank LC referral ${referral.referenceNo} (LC ${pick(referral.lcNumber, f.lcNumber)})`,
    f.commodity && `Commodity: ${f.commodity}${f.quantity ? ` · Qty ${f.quantity}` : ""}`,
    f.totalValue && `Value: ${f.totalValue}${f.priceTerm ? ` · ${f.priceTerm}` : ""}`,
    (f.originPort || f.destinationPort) && `Lane per LC: ${f.originPort ?? "?"} → ${f.destinationPort ?? "?"}`,
    f.latestShipmentDate && `Latest shipment: ${f.latestShipmentDate.toISOString().slice(0, 10)}`,
    f.expiryDate && `LC expiry: ${f.expiryDate.toISOString().slice(0, 10)}`,
    f.partialShipments && `Partial shipments: ${f.partialShipments}`,
    f.transhipment && `Transhipment: ${f.transhipment}`,
    f.beneficiaryName && `Beneficiary: ${f.beneficiaryName}`,
  ].filter(Boolean).join("\n");

  const result = await prisma.$transaction(async (tx) => {
    const materialized = await materializeCustomerAndQuery(tx, {
      source: "bank_lc",
      ownerId,
      createdById: req.user.id,
      companyName: pick(referral.companyName, pick(referral.applicantName, f.applicantName)),
      contactName,
      contactEmail: referral.applicantEmail,
      contactPhone: referral.applicantPhone,
      services,
      originPort,
      destinationPort,
      // The Query has no free-text field, and "IRON ORE PELLETS" alone does not tell
      // the person quoting how much of it there is. Quantity and price term ride along
      // here because this is the only place on the query they can be read.
      cargoDescription: [
        pick(referral.commodity, f.commodity),
        f.quantity,
        f.priceTerm,
      ].filter(Boolean).join(" · ") || null,
      incoterm: pick(referral.incoterm, f.incoterm),
      // "2500MT" is a number the LC states plainly; leaving it in prose means every
      // downstream weight calculation starts by re-reading the description.
      weightKg: parseQuantityKg(f.quantity),
      note: lcSummary,
    });

    // The credit's terms, kept on the query itself so the person quoting sees what
    // the bank actually wrote — expiry, latest shipment, partial/transhipment rules
    // and the documents demanded all change what a job costs. Snapshot semantics are
    // explained on the schema field.
    if (read) {
      await tx.query.update({
        where: { id: materialized.query.id },
        data: {
          lcDetails: {
            ...f,
            // Dates go in as ISO strings — JSON has no date type, and a Date here
            // would come back as an object nobody downstream expects.
            issueDate: f.issueDate?.toISOString() ?? null,
            expiryDate: f.expiryDate?.toISOString() ?? null,
            latestShipmentDate: f.latestShipmentDate?.toISOString() ?? null,
            referralRef: referral.referenceNo,
            // What the lane resolved to, and what it did not — an unresolved port is
            // a fact the quoting user needs, not a blank to be discovered later.
            resolvedOriginPort: originPort,
            resolvedDestinationPort: destinationPort,
            unresolvedPorts: [
              !originPort && f.originPort ? f.originPort : null,
              !destinationPort && f.destinationPort ? f.destinationPort : null,
            ].filter(Boolean),
            readAt: new Date().toISOString(),
          },
        },
      });
    }

    // Put the advice itself on the query. Quoting an LC shipment means reading the
    // LC — its documents-required list decides half the charges — and making the ops
    // user navigate back to an intake inbox to find it is how it gets quoted blind.
    // A second row cannot share a storageKey (it is unique), so the bytes are copied.
    if (read?.document) {
      const source = await tx.document.findUnique({ where: { id: read.document.id } });
      const from = source && absPathFor(source.storageKey);
      if (from && fs.existsSync(from)) {
        const storageKey = `${crypto.randomUUID()}.pdf`;
        fs.copyFileSync(from, absPathFor(storageKey));
        await tx.document.create({
          data: {
            ownerType: "query",
            ownerId: materialized.query.id,
            fileName: `${materialized.query.referenceNo}_Letter-of-Credit.pdf`,
            mimeType: source.mimeType,
            sizeBytes: source.sizeBytes,
            checksum: source.checksum,
            storageKey,
            docType: "lc",
            scanStatus: source.scanStatus,
            uploadedById: req.user.id,
          },
        });
      }
    }

    await tx.bankLcReferral.update({
      where: { id: referral.id },
      data: {
        status: "converted",
        reviewedById: req.user.id,
        convertedCustomerId: materialized.customer.id,
        convertedLeadId: materialized.lead.id,
        convertedQueryId: materialized.query.id,
      },
    });

    await emitEvent(tx, "lc.converted", {
      referralId: referral.id,
      referenceNo: referral.referenceNo,
      customerRef: materialized.customer.referenceNo,
      queryRef: materialized.query.referenceNo,
    });

    return materialized;
  });

  res.status(201).json({
    success: true,
    message: `Converted — customer ${result.customer.referenceNo}, query ${result.query.referenceNo}`,
    data: {
      customerId: result.customer.id,
      customerRef: result.customer.referenceNo,
      queryId: result.query.id,
      queryRef: result.query.referenceNo,
      portalInvited: !!result.portalInviteToken,
    },
    // The Notifications module would email the activation link; returned in
    // non-prod so the portal invite is testable without a mail server.
    ...(IS_PROD || !result.portalInviteToken ? {} : { devPortalInviteToken: result.portalInviteToken }),
  });
});
