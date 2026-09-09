import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { createShipmentFromApproval } from "../shipment/shipment.service.js";

/**
 * Customer acceptance (ADR-055 / ADR-056).
 *
 * A shipment is born only from the customer's OWN acceptance. Three acts qualify, and
 * every one of them runs through `assertApprovable` and then the same pivot:
 *
 *   approval_link    the customer decided through a one-time secure link (this file)
 *   customer_portal  the portal customer clicked Approve themselves (quotation.controllers)
 *   signed_copy      the customer signed the quotation on paper and Operations verified
 *                    the scan (`approveFromSignedCopy` below, called from verifyDocument)
 *
 * What is deliberately NOT here any more: an internal user approving on the customer's
 * behalf. That click recorded a Consort user as the decider, left no evidence the
 * customer ever agreed, and — because approval is the pivot that mints a shipment and
 * its tasks — cost Operations real time whenever the customer had not actually said
 * yes. Sales now RECORDS a verbal acceptance (`recordAcceptance`) and relays the link;
 * the record is informational, never a gate.
 *
 * ── One-time links ──
 *
 * The token is the only credential, so it is treated like a password:
 *  - 32 random bytes, base64url — 256 bits, not guessable;
 *  - only its SHA-256 hash is stored, and the plaintext is returned exactly once, so a
 *    dump of `approval_links` cannot be replayed into an approval;
 *  - looked up BY HASH, so there is no scan and no timing signal on the raw token;
 *  - single use, always expiring, revocable, and superseded when a new one is minted.
 */

/** How long a link lives when the caller does not say. */
export const DEFAULT_TTL_DAYS = 7;
export const MAX_TTL_DAYS = 30;

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * Why a link cannot be used right now, or null when it can.
 * Order matters: revoked beats expired beats used, so the message names the real cause.
 */
export const linkBlockReason = (link, now = new Date()) => {
  if (!link) return "not_found";
  if (link.revokedAt) return "revoked";
  if (link.decidedAt) return "used";
  if (new Date(link.expiresAt) <= now) return "expired";
  return null;
};

const BLOCK_MESSAGES = {
  not_found: "This approval link is not valid.",
  revoked: "This approval link was cancelled. Please ask your Consort contact for a new one.",
  used: "This quotation has already been decided through this link.",
  expired: "This approval link has expired. Please ask your Consort contact for a new one.",
};

export const blockMessage = (reason) => BLOCK_MESSAGES[reason] ?? BLOCK_MESSAGES.not_found;

/**
 * Resolve a raw token to its live link + quotation, or throw the 404/410 the public
 * endpoint should return. Never distinguishes "no such token" from "wrong token" —
 * both are `not_found`.
 */
export const resolveToken = async (rawToken) => {
  if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 200) {
    throw new AppError(blockMessage("not_found"), 404);
  }
  const link = await prisma.approvalLink.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: {
      quotation: {
        include: {
          chargeLines: { orderBy: { sortOrder: "asc" } },
          query: true,
        },
      },
    },
  });

  const reason = linkBlockReason(link);
  // A dead link still resolves for the GET, so the page can explain WHY rather than
  // showing a bare 404 to a customer who did nothing wrong. Writes re-check.
  if (reason === "not_found" || !link?.quotation) throw new AppError(blockMessage("not_found"), 404);
  return { link, reason };
};

/**
 * What the customer is allowed to see. This is the whole security surface of the public
 * page, so it is an ALLOWLIST — a field that is not named here cannot leak.
 *
 * Deliberately absent: `costAmount` and `costVendorId` (what Consort pays its vendors),
 * every internal id, the query's ownership, and the margin those two would reveal.
 */
export const publicQuoteView = (link) => {
  const q = link.quotation;
  return {
    referenceNo: q.referenceNo,
    currency: q.currency,
    totalAmount: q.totalAmount,
    validityDate: q.validityDate,
    // From the query's own contact snapshot — the customer's own details, shown back to
    // them so they can tell at a glance which enquiry this is. No customer record, no
    // ownership, no internal ids.
    contactName: q.query?.customerName ?? null,
    pickupAddress: q.query?.pickupAddress ?? null,
    destinationAddress: q.query?.destinationAddress ?? null,
    chargeLines: (q.chargeLines ?? []).map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.amount,
    })),
    state: {
      status: linkBlockReason(link) ?? "open",
      expiresAt: link.expiresAt,
      decision: link.decision ?? null,
      decidedAt: link.decidedAt ?? null,
    },
  };
};

/**
 * Everything that must be true of a quotation before ANY channel may approve it
 * (RULE-QT-08). One function so the three entry points cannot drift apart: the same
 * quote is either approvable or it is not, whoever is asking.
 *
 *   status       only a SENT quote is open for a decision
 *   query        a cancelled enquiry must never mint a shipment
 *   validity     an expired quote needs revising, not approving
 *   credit       outstanding receivables + this quote must fit the customer's limit
 *
 * `audience` shapes the message, not the rule. The customer is never told their
 * credit limit or exposure — "needs a review by Consort" is all they get.
 *
 * @param db         prisma client or an open transaction
 * @param quotation  with `query` included
 */
export const assertApprovable = async (db, { quotation, customer, audience = "internal" }) => {
  const forCustomer = audience === "customer";
  const contact = " Please contact Consort.";

  if (quotation.status !== "sent") {
    throw new AppError(
      forCustomer
        ? `This quotation is no longer open for a decision.${contact}`
        : `Only a sent quotation can be approved (this one is ${quotation.status})`,
      409,
    );
  }
  if (quotation.query?.status === "cancelled") {
    throw new AppError(
      forCustomer
        ? `The enquiry behind this quotation was cancelled.${contact}`
        : "The query behind this quotation was cancelled",
      409,
    );
  }
  if (quotation.validityDate && new Date(quotation.validityDate) < new Date()) {
    throw new AppError(
      forCustomer
        ? "This quotation has passed its validity date. Please ask Consort for a new one."
        : "This quotation has expired and cannot be approved",
      409,
    );
  }
  if (!customer) {
    throw new AppError(forCustomer ? "This quotation is no longer available." : "Customer not found", forCustomer ? 409 : 404);
  }

  if (customer.creditLimit != null) {
    const invoices = await db.invoice.findMany({
      where: { shipment: { customerId: customer.id }, status: { in: ["issued", "part_paid"] } },
      select: { totalAmount: true, payments: { select: { amount: true } } },
    });
    const outstanding = invoices.reduce(
      (sum, inv) => sum + Number(inv.totalAmount) - inv.payments.reduce((a, p) => a + Number(p.amount), 0),
      0,
    );
    if (outstanding + Number(quotation.totalAmount) > Number(customer.creditLimit)) {
      throw new AppError(
        forCustomer
          ? "This order needs a review by Consort before it can be confirmed. Please contact your Consort representative."
          : `CREDIT_LIMIT_EXCEEDED — outstanding ${outstanding.toFixed(2)} + this quotation exceeds the credit limit ${Number(customer.creditLimit).toFixed(2)} (RULE-QT-08)`,
        422,
      );
    }
  }
};

/** A link never outlives the quote it approves. */
const linkExpiry = (ttlDays, validityDate) => {
  const days = Math.min(Math.max(Number(ttlDays) || DEFAULT_TTL_DAYS, 1), MAX_TTL_DAYS);
  const byTtl = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  if (validityDate && new Date(validityDate) < byTtl) return new Date(validityDate);
  return byTtl;
};

/**
 * Mint a link for a quotation, revoking whatever was live for it before.
 *
 * Returns the PLAINTEXT token alongside the row. That is the only time it exists —
 * the caller must hand it straight to the response and never log it.
 *
 * `db` may be an open transaction (recordAcceptance mints inside its own) or, by
 * default, the client — in which case a transaction is opened here so the revoke and
 * the create are one write.
 */
export const issueLink = async ({ quotationId, actorId, ttlDays, validityDate, db = prisma }) => {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = linkExpiry(ttlDays, validityDate);

  const mint = async (tx) => {
    // Exactly one live link per quotation: a superseded one dies immediately, so a
    // link that leaked out of an old WhatsApp thread cannot still approve anything.
    await tx.approvalLink.updateMany({
      where: { quotationId, decidedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: actorId },
    });
    const row = await tx.approvalLink.create({
      data: { tokenHash: hashToken(token), subject: "quotation", quotationId, createdById: actorId, expiresAt },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "quotation.approval_link.issued",
        resourceType: "quotation",
        resourceId: quotationId,
        diff: { approvalLinkId: row.id, expiresAt },
        correlationId: crypto.randomUUID(),
      },
    });
    return row;
  };

  const link = db === prisma ? await prisma.$transaction(mint) : await mint(db);
  return { link, token };
};

/**
 * Sales records that the customer said yes (on a call, over WhatsApp, in a meeting)
 * and gets a fresh link to relay in the same breath (ADR-056).
 *
 * The claim is informational — it changes nothing about what the quote can do — but
 * it is what the ops desk sees as "expected order, awaiting confirmation", and it is
 * what the lapse sweep measures against when the link goes unused.
 */
export const recordAcceptance = async ({ quotation, actorId, via, note, ttlDays }) =>
  prisma.$transaction(async (tx) => {
    await tx.quotation.update({
      where: { id: quotation.id },
      data: {
        acceptanceClaimedById: actorId,
        acceptanceClaimedAt: new Date(),
        acceptanceClaimedVia: via,
        acceptanceClaimNote: note ?? null,
      },
    });
    const { link, token } = await issueLink({
      quotationId: quotation.id,
      actorId,
      ttlDays,
      validityDate: quotation.validityDate,
      db: tx,
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "quotation.acceptance.claimed",
        resourceType: "quotation",
        resourceId: quotation.id,
        diff: { via, note: note ?? null, approvalLinkId: link.id, expiresAt: link.expiresAt },
        correlationId: crypto.randomUUID(),
      },
    });
    await tx.outboxEvent.create({
      data: {
        eventType: "quotation.acceptance_claimed",
        payload: {
          quotationId: quotation.id,
          referenceNo: quotation.referenceNo,
          queryId: quotation.queryId,
          customerId: quotation.query?.customerId ?? null,
          claimedById: actorId,
          via,
          expiresAt: link.expiresAt,
        },
        correlationId: crypto.randomUUID(),
      },
    });
    return { link, token };
  });

/**
 * The paper path (ADR-056): the customer signed the quotation, someone uploaded the
 * scan as a `quotation_acceptance` document on the quotation, and an Operations user
 * — never the uploader — has just marked it `verified`. That verification IS the
 * acceptance, so the pivot runs here, inside the verifier's transaction, and rolls
 * back with the verification if it cannot.
 *
 * `decidedById` stays NULL: the verifier confirmed evidence, the customer decided.
 * The generated PDFs are attributed to the verifier, who is the Consort user that
 * caused them to exist.
 */
export const approveFromSignedCopy = async (tx, { document, verifierId }) => {
  const quotation = await tx.quotation.findUnique({
    where: { id: document.ownerId },
    include: { chargeLines: { orderBy: { sortOrder: "asc" } }, query: true },
  });
  if (!quotation) throw new AppError("Quotation not found", 404);
  const customer = await tx.customer.findUnique({ where: { id: quotation.query.customerId } });
  await assertApprovable(tx, { quotation, customer, audience: "internal" });

  const created = await createShipmentFromApproval(tx, {
    quotation,
    query: quotation.query,
    customer,
    actorId: null,
    authorId: verifierId,
    approvalChannel: "signed_copy",
  });
  await tx.quotation.update({
    where: { id: quotation.id },
    data: { acceptanceDocumentId: document.id },
  });
  // A link still out there must not approve a quote that is already approved — the
  // status check would refuse it anyway, but a dead link tells the customer why.
  await tx.approvalLink.updateMany({
    where: { quotationId: quotation.id, decidedAt: null, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: verifierId },
  });
  await tx.auditLog.create({
    data: {
      actorId: null,
      action: "quotation.approved.signed_copy",
      resourceType: "quotation",
      resourceId: quotation.id,
      diff: { documentId: document.id, verifiedById: verifierId, shipmentId: created.shipment.id },
      correlationId: crypto.randomUUID(),
    },
  });
  return { ...created, quotation };
};

/** Kill the live link for a quotation. Idempotent — no live link is not an error. */
export const revokeLinks = async ({ quotationId, actorId }) => {
  const now = new Date();
  const { count } = await prisma.approvalLink.updateMany({
    where: { quotationId, decidedAt: null, revokedAt: null },
    data: { revokedAt: now, revokedById: actorId },
  });
  if (count) {
    await prisma.auditLog.create({
      data: {
        actorId,
        action: "quotation.approval_link.revoked",
        resourceType: "quotation",
        resourceId: quotationId,
        diff: { revoked: count },
        correlationId: crypto.randomUUID(),
      },
    });
  }
  return count;
};

/** The live link for a quotation, without ever exposing the token or its hash. */
export const activeLinkFor = async (quotationId) => {
  const link = await prisma.approvalLink.findFirst({
    where: { quotationId, decidedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return link ? summarise(link) : null;
};

/** The most recent decision made through a link, for the internal review panel. */
export const lastDecisionFor = async (quotationId) => {
  const link = await prisma.approvalLink.findFirst({
    where: { quotationId, decidedAt: { not: null } },
    orderBy: { decidedAt: "desc" },
  });
  return link ? summarise(link) : null;
};

/** Never includes `tokenHash` — nothing internal needs it, and it must not travel. */
export const summarise = (link) => ({
  id: link.id,
  subject: link.subject,
  createdAt: link.createdAt,
  expiresAt: link.expiresAt,
  revokedAt: link.revokedAt,
  decision: link.decision,
  decidedAt: link.decidedAt,
  approverName: link.approverName,
  approverEmail: link.approverEmail,
  status: linkBlockReason(link) ?? "open",
});

/**
 * Claim the link for a decision, atomically.
 *
 * The `updateMany` with the full liveness predicate is the concurrency guard: two
 * simultaneous submits both match at most once, so the loser gets 0 and is told the
 * link is spent rather than both driving an approval.
 */
export const claimLink = async (linkId, { decision, approverName, approverEmail, approverIp, approverAgent, reason }) => {
  const { count } = await prisma.approvalLink.updateMany({
    where: { id: linkId, decidedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: {
      decision,
      decidedAt: new Date(),
      approverName,
      approverEmail,
      approverIp: approverIp ?? null,
      approverAgent: approverAgent ? String(approverAgent).slice(0, 400) : null,
      reason: reason ?? null,
    },
  });
  return count === 1;
};

/** Hand the claim back if the decision it was claimed for could not be completed. */
export const releaseLink = (linkId) =>
  prisma.approvalLink.updateMany({
    where: { id: linkId },
    data: { decision: null, decidedAt: null, approverName: null, approverEmail: null, approverIp: null, approverAgent: null, reason: null },
  });
