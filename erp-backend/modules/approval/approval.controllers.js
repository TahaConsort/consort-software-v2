import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { quotationInScope } from "../quotation/quotation.middleware.js";
import { createShipmentFromApproval } from "../shipment/shipment.service.js";
import * as svc from "./approval.service.js";

/**
 * One-time customer approval links — the internal admin half and the anonymous public
 * half (ADR-055).
 *
 * The public half is the only unauthenticated write in the app outside the bank webhook,
 * so every handler here re-checks liveness against the database rather than trusting
 * anything the caller sends. The token IS the authorisation; there is nothing else.
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

/** Only a quote that is actually live may be put in front of a customer. */
const loadSentQuotation = async (req) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: req.params.id },
    include: { query: true },
  });
  if (!quotation || !quotationInScope(req, quotation)) throw new AppError("Quotation not found", 404);
  return quotation;
};

/* ── POST /api/quotations/:id/approval-link ── mint (permission: quotation.share) */
export const issueApprovalLink = catchAsync(async (req, res, next) => {
  const quotation = await loadSentQuotation(req);
  if (quotation.status !== "sent") {
    return next(new AppError(`Only a sent quotation can be put up for approval (this one is ${quotation.status})`, 409));
  }
  if (quotation.validityDate && new Date(quotation.validityDate) < new Date()) {
    return next(new AppError("This quotation has expired — revise it before sending it for approval", 409));
  }

  const { link, token } = await svc.issueLink({
    quotationId: quotation.id,
    actorId: req.user.id,
    ttlDays: req.body.expiresInDays,
    validityDate: quotation.validityDate,
  });

  res.status(201).json({
    success: true,
    message: "Approval link created — copy it now, it is not shown again",
    // The ONLY time the plaintext token leaves the server. The client turns it into a
    // URL against its own origin, so no base-URL config is needed here.
    data: { ...svc.summarise(link), token },
  });
});

/* ── POST /api/quotations/:id/acceptance ── record a verbal yes + mint the link (ADR-056) */
export const recordAcceptance = catchAsync(async (req, res) => {
  const quotation = await loadSentQuotation(req);
  // No point recording a yes on a quote that could not be approved anyway — the
  // customer would open a link that refuses them.
  const customer = await prisma.customer.findUnique({ where: { id: quotation.query.customerId } });
  await svc.assertApprovable(prisma, { quotation, customer, audience: "internal" });

  const { link, token } = await svc.recordAcceptance({
    quotation,
    actorId: req.user.id,
    via: req.body.via,
    note: req.body.note,
    ttlDays: req.body.expiresInDays,
  });

  res.status(201).json({
    success: true,
    message: "Acceptance recorded — send the customer the link so they can confirm it",
    data: { ...svc.summarise(link), token },
  });
});

/* ── GET /api/quotations/:id/approval-link ── status only, never the token */
export const getApprovalLink = catchAsync(async (req, res) => {
  const quotation = await loadSentQuotation(req);
  const [active, lastDecision] = await Promise.all([
    svc.activeLinkFor(quotation.id),
    svc.lastDecisionFor(quotation.id),
  ]);
  res.json({ success: true, data: { active, lastDecision } });
});

/* ── DELETE /api/quotations/:id/approval-link ── revoke */
export const revokeApprovalLink = catchAsync(async (req, res) => {
  const quotation = await loadSentQuotation(req);
  const revoked = await svc.revokeLinks({ quotationId: quotation.id, actorId: req.user.id });
  res.json({
    success: true,
    message: revoked ? "Approval link cancelled — it can no longer be used" : "There was no live approval link",
    data: { revoked },
  });
});

/* ── GET /api/public/approvals/:token ── ANONYMOUS */
export const viewApproval = catchAsync(async (req, res) => {
  const { link, reason } = await svc.resolveToken(req.params.token);
  // A dead link still renders, so the customer is told what happened instead of being
  // shown a bare error for something that is not their fault.
  res.json({
    success: true,
    message: reason ? svc.blockMessage(reason) : undefined,
    data: svc.publicQuoteView(link),
  });
});

/* ── POST /api/public/approvals/:token/decision ── ANONYMOUS, the pivot */
export const decideApproval = catchAsync(async (req, res, next) => {
  const { link, reason: blocked } = await svc.resolveToken(req.params.token);
  if (blocked) return next(new AppError(svc.blockMessage(blocked), 410));

  const { decision, approverName, approverEmail, reason } = req.body;
  const quotation = link.quotation;
  const customer = await prisma.customer.findUnique({ where: { id: quotation.query.customerId } });

  // Re-check the quote itself, not just the link: it may have been withdrawn, revised
  // or approved another way since the link went out. A rejection needs the quote to be
  // open too, but not the customer's credit standing — so only the approve path runs
  // the full guard; the reject path checks the same three liveness rules by hand.
  if (decision === "approved") {
    await svc.assertApprovable(prisma, { quotation, customer, audience: "customer" });
  } else {
    if (quotation.status !== "sent") {
      return next(new AppError("This quotation is no longer open for a decision. Please contact Consort.", 409));
    }
    if (quotation.query?.status === "cancelled") {
      return next(new AppError("The enquiry behind this quotation was cancelled. Please contact Consort.", 409));
    }
    if (!customer) return next(new AppError("This quotation is no longer available.", 409));
  }

  // Claim FIRST. Two people opening the same mail and submitting together both reach
  // here; only one wins the claim, and the other is told the link is spent rather than
  // both driving a decision.
  const claimed = await svc.claimLink(link.id, {
    decision,
    approverName,
    approverEmail,
    approverIp: req.ip,
    approverAgent: req.headers["user-agent"],
    reason,
  });
  if (!claimed) return next(new AppError(svc.blockMessage("used"), 410));

  try {
    if (decision === "rejected") {
      await prisma.$transaction(async (tx) => {
        const u = await tx.quotation.update({
          where: { id: quotation.id },
          data: {
            status: "rejected",
            // No internal user decided this, so `decidedById` stays null — the
            // approval_links row is the record of who did.
            decidedAt: new Date(),
            approvalChannel: "approval_link",
            rejectionReason: reason,
            rowVersion: { increment: 1 },
          },
        });
        // Query → revision_requested ("re-quote me", ADR-030) — same as the internal path.
        await tx.query.update({ where: { id: u.queryId }, data: { status: "revision_requested" } });
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "quotation.rejected.approval_link",
            resourceType: "quotation",
            resourceId: u.id,
            diff: { approvalLinkId: link.id, approverName, approverEmail, ip: req.ip },
            correlationId: crypto.randomUUID(),
          },
        });
        await emitEvent(tx, "quotation.rejected", {
          quotationId: u.id, referenceNo: u.referenceNo, queryId: u.queryId,
        });
      });

      return res.json({
        success: true,
        message: "Thank you — your feedback has been sent to Consort, who will send a revised quote.",
        data: { decision },
      });
    }

    // THE PIVOT (RULE-QT-07) — the identical path the portal approve takes, so the
    // shipment, its composed OTD steps, charges and draft invoice are all created the
    // same way. `actorId: null` because no internal user made this call.
    const result = await prisma.$transaction(
      async (tx) => {
        const created = await createShipmentFromApproval(tx, {
          quotation: await tx.quotation.findUnique({
            where: { id: quotation.id },
            include: { chargeLines: { orderBy: { sortOrder: "asc" } }, query: true },
          }),
          query: quotation.query,
          customer,
          // No internal user decided this — the customer did (ADR-055).
          actorId: null,
          // But the generated quotation + Rate Confirmation PDFs still need an author:
          // `documents.uploaded_by_id` is NOT nullable, and both writes sit inside a
          // best-effort catch, so a null here loses the RC silently. Consort generated
          // them, so they are attributed to whoever issued the link.
          authorId: link.createdById,
          approvalChannel: "approval_link",
        });
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "quotation.approved.approval_link",
            resourceType: "quotation",
            resourceId: quotation.id,
            diff: {
              approvalLinkId: link.id,
              approverName,
              approverEmail,
              ip: req.ip,
              shipmentId: created.shipment.id,
            },
            correlationId: crypto.randomUUID(),
          },
        });
        return created;
      },
      { timeout: 20000 },
    );

    return res.json({
      success: true,
      message: `Thank you — your approval is recorded and Consort has started shipment ${result.shipment.referenceNo}.`,
      data: { decision, shipmentRef: result.shipment.referenceNo },
    });
  } catch (err) {
    // The claim is only meaningful if the decision behind it landed. Hand it back so a
    // transient failure does not burn the customer's one chance to approve.
    await svc.releaseLink(link.id).catch(() => {});
    if (err?.code === "P2002") {
      return next(new AppError("This quotation has already been approved.", 409));
    }
    throw err;
  }
});
