import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { materializeCustomerAndQuery } from "../intake/intake.service.js";
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
  const updated = await prisma.bankLcReferral.update({
    where: { id: referral.id },
    data: { status: req.body.status, reviewedById: req.user.id },
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
  const updated = await prisma.bankLcReferral.update({
    where: { id: referral.id },
    data: { status: "rejected", reviewedById: req.user.id, rejectReason: req.body.reason },
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
  // Applicant is the buyer/importer; fall back to beneficiary or company name.
  const contactName = referral.applicantName || referral.beneficiaryName || referral.companyName || "LC Applicant";
  // lc_finance is always implied for the bank_lc channel (intake.service adds it).
  const services = req.body.services?.length ? req.body.services : ["sea_freight", "lc_finance"];

  const result = await prisma.$transaction(async (tx) => {
    const materialized = await materializeCustomerAndQuery(tx, {
      source: "bank_lc",
      ownerId,
      createdById: req.user.id,
      companyName: referral.companyName || referral.applicantName,
      contactName,
      contactEmail: referral.applicantEmail,
      contactPhone: referral.applicantPhone,
      services,
      originPort: referral.originPort,
      destinationPort: referral.destinationPort,
      cargoDescription: referral.commodity,
      incoterm: referral.incoterm,
      note: `Converted from bank LC referral ${referral.referenceNo} (LC ${referral.lcNumber})`,
    });

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
