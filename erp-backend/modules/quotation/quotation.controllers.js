import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { DEFAULT_CURRENCY } from "../../utils/currency.js";
import { isManagement, hasRole } from "../auth/auth.middleware.js";
import { scopedQuotationWhere, quotationInScope } from "./quotation.middleware.js";
import { createShipmentFromApproval } from "../shipment/shipment.service.js";

/**
 * Quotation (CRM_MASTER §5.7, WORKFLOW §4/§9, RULE-QT).
 *   draft → sent (ops_manager only) → approved | rejected | expired
 * Approval is the system's pivot (RULE-QT-07): one transaction births the
 * shipment, its composed OTD steps, OTC milestones, chat channel and draft
 * invoice — all or nothing.
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

/* ── GET /api/quotations/charge-types ── (catalog for the quote-builder dropdown) */
export const listChargeTypes = catchAsync(async (req, res) => {
  const types = await prisma.chargeType.findMany({ where: { isActive: true }, orderBy: { label: "asc" } });
  res.json({ success: true, data: types });
});

// Server-side line + total computation (RULE-QT-02 — client totals ignored).
const priceLines = (chargeLines) =>
  chargeLines.map((l, i) => {
    const quantity = Number(l.quantity ?? 1);
    const unitPrice = Number(l.unitPrice);
    return {
      service: l.service ?? null,
      // Cost sheet (internal) — the buy-side expectation, read back as the P&L estimate.
      chargeCode: l.chargeCode ?? null,
      costAmount: l.costAmount != null ? Number(l.costAmount) : null,
      costVendorId: l.costVendorId ?? null,
      description: l.description,
      quantity,
      unitPrice,
      amount: Math.round(quantity * unitPrice * 100) / 100,
      sortOrder: l.sortOrder ?? i,
    };
  });

const totalOf = (lines) => Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;

// Cost-sheet fields are internal only — scrubbed from portal-customer responses.
const scrubCost = (qt) => ({
  ...qt,
  chargeLines: qt.chargeLines?.map(({ costAmount, costVendorId, chargeCode, ...l }) => l),
});

const hydrate = async (quotations, { includeCost = true } = {}) => {
  if (!includeCost) quotations = quotations.map(scrubCost);
  const queryIds = [...new Set(quotations.map((q) => q.queryId))];
  const queries = await prisma.query.findMany({
    where: { id: { in: queryIds } },
    select: { id: true, referenceNo: true, customerId: true, status: true },
  });
  const customerIds = [...new Set(queries.map((q) => q.customerId))];
  const customers = await prisma.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, referenceNo: true, companyId: true, assignedBdoId: true },
  });
  const companies = await prisma.company.findMany({
    where: { id: { in: customers.map((c) => c.companyId) } },
    select: { id: true, name: true },
  });
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const custById = new Map(customers.map((c) => [c.id, c]));
  const qById = new Map(queries.map((q) => [q.id, q]));

  return quotations.map((qt) => {
    const query = qById.get(qt.queryId);
    const customer = query ? custById.get(query.customerId) : null;
    return {
      ...qt,
      queryRef: query?.referenceNo ?? "—",
      queryStatus: query?.status ?? null,
      customerRef: customer?.referenceNo ?? "—",
      customerCompany: customer ? companyName.get(customer.companyId) ?? "—" : "—",
    };
  });
};

/* ── GET /api/quotations?queryId=&status= ── */
export const listQuotations = catchAsync(async (req, res) => {
  const extra = {};
  if (req.query.queryId) extra.queryId = req.query.queryId;
  if (req.query.status) extra.status = req.query.status;
  const where = scopedQuotationWhere(req, extra);
  const quotations = await prisma.quotation.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: { chargeLines: { orderBy: { sortOrder: "asc" } } },
  });
  res.json({ success: true, data: await hydrate(quotations, { includeCost: !req.user?.customerId }) });
});

/* ── GET /api/quotations/:id ── */
export const getQuotation = catchAsync(async (req, res, next) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: req.params.id },
    include: { chargeLines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!quotation || !quotationInScope(req, quotation)) return next(new AppError("Quotation not found", 404));
  const [hydrated] = await hydrate([quotation], { includeCost: !req.user?.customerId });
  res.json({ success: true, data: hydrated });
});

/* ── POST /api/quotations ── (ops drafts; RULE-QT-01) */
export const createQuotation = catchAsync(async (req, res, next) => {
  const query = await prisma.query.findUnique({ where: { id: req.body.queryId } });
  if (!query) return next(new AppError("Query not found", 404));
  if (!["open", "quoted", "revision_requested"].includes(query.status)) {
    return next(new AppError(`Cannot quote a ${query.status} query`, 409));
  }

  const lines = priceLines(req.body.chargeLines);

  try {
    const quotation = await prisma.$transaction(async (tx) => {
      const referenceNo = await allocateRef(tx, "quotation");
      return tx.quotation.create({
        data: {
          referenceNo,
          queryId: query.id,
          // Snapshot from the query (INV-14 lineage) — all three travel together, since
          // the package and CRO mode are what compose the OTD path at approval.
          services: query.services,
          servicePackage: query.servicePackage,
          croHandledBy: query.croHandledBy,
          currency: req.body.currency ?? DEFAULT_CURRENCY,
          fxRate: req.body.fxRate ?? undefined,
          validityDate: req.body.validityDate ?? undefined,
          totalAmount: totalOf(lines),
          createdById: req.user.id,
          chargeLines: { create: lines },
        },
        include: { chargeLines: { orderBy: { sortOrder: "asc" } } },
      });
    });
    const [hydrated] = await hydrate([quotation]);
    res.status(201).json({ success: true, message: "Quotation drafted", data: hydrated });
  } catch (err) {
    if (err?.code === "P2002") {
      return next(new AppError("A live quotation already exists for this query (INV-07)", 409));
    }
    throw err;
  }
});

/* ── PUT /api/quotations/:id ── (edit a draft) */
export const updateQuotation = catchAsync(async (req, res, next) => {
  const quotation = await prisma.quotation.findUnique({ where: { id: req.params.id } });
  if (!quotation || !quotationInScope(req, quotation)) return next(new AppError("Quotation not found", 404));
  if (quotation.status !== "draft") {
    return next(new AppError(`Only a draft quotation can be edited (this one is ${quotation.status})`, 409));
  }

  const data = {
    currency: req.body.currency ?? quotation.currency,
    fxRate: req.body.fxRate ?? quotation.fxRate ?? undefined,
    validityDate: req.body.validityDate ?? quotation.validityDate ?? undefined,
  };

  const updated = await prisma.$transaction(async (tx) => {
    if (req.body.chargeLines) {
      const lines = priceLines(req.body.chargeLines);
      await tx.quotationChargeLine.deleteMany({ where: { quotationId: quotation.id } });
      await tx.quotationChargeLine.createMany({
        data: lines.map((l) => ({ ...l, quotationId: quotation.id })),
      });
      data.totalAmount = totalOf(lines);
    }
    return tx.quotation.update({
      where: { id: quotation.id },
      data: { ...data, rowVersion: { increment: 1 } },
      include: { chargeLines: { orderBy: { sortOrder: "asc" } } },
    });
  });

  const [hydrated] = await hydrate([updated]);
  res.json({ success: true, message: "Quotation updated", data: hydrated });
});

/* ── POST /api/quotations/:id/send ── (ops_manager only — RULE-QT-01) */
export const sendQuotation = catchAsync(async (req, res, next) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: req.params.id },
    include: { chargeLines: true },
  });
  if (!quotation || !quotationInScope(req, quotation)) return next(new AppError("Quotation not found", 404));
  if (quotation.status !== "draft") {
    return next(new AppError(`Only a draft can be sent (this one is ${quotation.status})`, 409));
  }
  if (!quotation.chargeLines.length) return next(new AppError("Add at least one charge line before sending", 422));

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.quotation.update({
      where: { id: quotation.id },
      data: { status: "sent", sentById: req.user.id, sentAt: new Date(), rowVersion: { increment: 1 } },
    });
    await tx.query.update({ where: { id: quotation.queryId }, data: { status: "quoted" } });
    await emitEvent(tx, "quotation.sent", { quotationId: u.id, referenceNo: u.referenceNo, queryId: u.queryId });
    return u;
  });

  const [hydrated] = await hydrate([updated]);
  res.json({ success: true, message: "Quotation sent to the customer", data: hydrated });
});

/* ── POST /api/quotations/:id/approve ── THE PIVOT (RULE-QT-07, WORKFLOW §9) */
export const approveQuotation = catchAsync(async (req, res, next) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: req.params.id },
    include: { chargeLines: { orderBy: { sortOrder: "asc" } }, query: true },
  });
  if (!quotation || !quotationInScope(req, quotation)) return next(new AppError("Quotation not found", 404));
  if (quotation.status !== "sent") {
    return next(new AppError(`Only a sent quotation can be approved (this one is ${quotation.status})`, 409));
  }
  // Validity (RULE-QT-08).
  if (quotation.validityDate && new Date(quotation.validityDate) < new Date()) {
    return next(new AppError("This quotation has expired and cannot be approved", 409));
  }
  // Optimistic concurrency (If-Match) — MANDATORY; guards double-click / two
  // tabs (RULE-QT-08, EDGE-QT-01).
  const ifMatch = req.body.rowVersion ?? req.headers["if-match"];
  if (ifMatch === undefined) {
    return next(new AppError("rowVersion (If-Match) is required to approve (RULE-QT-08)", 428));
  }
  if (Number(ifMatch) !== quotation.rowVersion) {
    return next(new AppError("Quotation changed since you loaded it — reload and retry", 412));
  }

  const customer = await prisma.customer.findUnique({ where: { id: quotation.query.customerId } });
  if (!customer) return next(new AppError("Customer not found", 404));

  // Who may approve, and on whose behalf:
  if (req.user.role === "customer") {
    // A portal customer may only approve their own (scope C).
    if (req.user.customerId !== customer.id) {
      return next(new AppError("Quotation not found", 404));
    }
  } else if (hasRole(req.user, "bdo") && !hasRole(req.user, "asm") && !isManagement(req.user)) {
    // A BDO may approve on the customer's behalf (verbal acceptance on a call),
    // but ONLY for a query they themselves raised — a deliberate, scoped
    // relaxation of the RULE-QT-03 four-eyes bar (product decision 2026-07).
    // quotationInScope already limits a BDO to their own queries; this is the
    // explicit guard so the intent is enforced here too, not just by scope.
    if (quotation.query.raisedById !== req.user.id) {
      return next(new AppError("A BDO can only approve a quotation for a query they raised", 403));
    }
  } else if (req.user.id === customer.assignedBdoId) {
    // Any OTHER internal approver (ASM/Management) is still held to four-eyes:
    // the owning BDO must not slip a self-approval through a non-BDO path (RULE-QT-03).
    return next(new AppError("The owning BDO cannot approve their own quotation (RULE-QT-03)", 403));
  }

  // Credit standing (RULE-QT-08) — outstanding receivables + this quote must fit
  // inside the customer's credit limit (when one is set).
  if (customer.creditLimit != null) {
    const invoices = await prisma.invoice.findMany({
      where: { shipment: { customerId: customer.id }, status: { in: ["issued", "part_paid"] } },
      select: { totalAmount: true, payments: { select: { amount: true } } },
    });
    const outstanding = invoices.reduce(
      (sum, inv) => sum + Number(inv.totalAmount) - inv.payments.reduce((a, p) => a + Number(p.amount), 0),
      0,
    );
    const exposure = outstanding + Number(quotation.totalAmount);
    if (exposure > Number(customer.creditLimit)) {
      return next(new AppError(
        `CREDIT_LIMIT_EXCEEDED — outstanding ${outstanding.toFixed(2)} + this quotation exceeds the credit limit ${Number(customer.creditLimit).toFixed(2)} (RULE-QT-08)`,
        422,
      ));
    }
  }

  // BDO folds into the `asm` channel — the "internal, on the customer's behalf"
  // bucket — since the ApprovalChannel enum has no dedicated `bdo` member.
  const approvalChannel =
    req.user.role === "customer" ? "customer_portal" : isManagement(req.user) ? "management" : "asm";

  let result;
  try {
    result = await prisma.$transaction(
      async (tx) => {
        return createShipmentFromApproval(tx, {
          quotation,
          query: quotation.query,
          customer,
          actorId: req.user.id,
          approvalChannel,
        });
      },
      // The pivot writes the shipment, its whole composed path, charges, the chat
      // channel and the draft invoice — give it headroom over slower connections.
      { timeout: 20000 },
    );
  } catch (err) {
    if (err?.code === "P2002") {
      return next(new AppError("This query already has an approved quotation (INV-08)", 409));
    }
    throw err;
  }

  res.json({
    success: true,
    message: `Approved — shipment ${result.shipment.referenceNo} created with ${result.stepCount} OTD steps`,
    data: { shipmentId: result.shipment.id, shipmentRef: result.shipment.referenceNo, stepCount: result.stepCount },
  });
});

/* ── POST /api/quotations/:id/reject ── (RULE-QT-04) */
export const rejectQuotation = catchAsync(async (req, res, next) => {
  const quotation = await prisma.quotation.findUnique({ where: { id: req.params.id } });
  if (!quotation || !quotationInScope(req, quotation)) return next(new AppError("Quotation not found", 404));
  if (quotation.status !== "sent") {
    return next(new AppError(`Only a sent quotation can be rejected (this one is ${quotation.status})`, 409));
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.quotation.update({
      where: { id: quotation.id },
      data: {
        status: "rejected",
        decidedById: req.user.id,
        decidedAt: new Date(),
        rejectionReason: req.body.reason,
        rowVersion: { increment: 1 },
      },
    });
    // Query → revision_requested ("re-quote me", distinct from rejected — ADR-030).
    await tx.query.update({ where: { id: u.queryId }, data: { status: "revision_requested" } });
    await emitEvent(tx, "quotation.rejected", { quotationId: u.id, referenceNo: u.referenceNo, queryId: u.queryId });
    return u;
  });

  const [hydrated] = await hydrate([updated]);
  res.json({ success: true, message: "Quotation rejected — a revision can now be drafted", data: hydrated });
});

/* ── POST /api/quotations/:id/revise ── (new row, ADR-019) */
export const reviseQuotation = catchAsync(async (req, res, next) => {
  const parent = await prisma.quotation.findUnique({
    where: { id: req.params.id },
    include: { chargeLines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!parent || !quotationInScope(req, parent)) return next(new AppError("Quotation not found", 404));
  if (["draft", "sent"].includes(parent.status)) {
    return next(new AppError("Finish or reject the live quotation before revising (INV-07)", 409));
  }

  const revision = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateRef(tx, "quotation");
    return tx.quotation.create({
      data: {
        referenceNo,
        queryId: parent.queryId,
        version: parent.version + 1,
        parentQuotationId: parent.id,
        status: "draft",
        services: parent.services,
        servicePackage: parent.servicePackage,
        croHandledBy: parent.croHandledBy,
        currency: parent.currency,
        fxRate: parent.fxRate ?? undefined,
        totalAmount: parent.totalAmount,
        createdById: req.user.id,
        chargeLines: {
          create: parent.chargeLines.map((l) => ({
            service: l.service,
            chargeCode: l.chargeCode,
            costAmount: l.costAmount,
            costVendorId: l.costVendorId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            amount: l.amount,
            sortOrder: l.sortOrder,
          })),
        },
      },
      include: { chargeLines: { orderBy: { sortOrder: "asc" } } },
    });
  });

  const [hydrated] = await hydrate([revision]);
  res.status(201).json({ success: true, message: `Revision v${revision.version} drafted`, data: hydrated });
});
