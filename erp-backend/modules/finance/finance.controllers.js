import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { DEFAULT_CURRENCY } from "../../utils/currency.js";
import { invoiceInScope } from "./finance.middleware.js";
import { completeMilestoneTx, maybeSettleTx, invoiceStateTx } from "../otc/otc.service.js";
import { assertShipmentUnlocked, assertPayableWritable } from "../shipment/shipment.service.js";

// Receivable writes lock on settled; payable writes stay open until closed/cancelled.
const assertInvoiceWritable = (shipment, kind, action) =>
  kind === "payable" ? assertPayableWritable(shipment, action) : assertShipmentUnlocked(shipment, action);

/**
 * Finance (CRM_MASTER §5.11, RULE-FI). Invoices auto-drafted at approval
 * (RULE-FI-01); Accounts issues them and records payments. Issuance auto-
 * completes OTC milestone 1; full settlement auto-completes milestone 2
 * (RULE-FI-02/03) — both via the shared otc.service so the OTC settle rule lives
 * in exactly one place (ADR-001). Manual milestones 3–5 live in the OTC module.
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

/* ── POST /api/finance/invoices ── (manual invoice from a step — payable/receivable) */
export const createInvoice = catchAsync(async (req, res, next) => {
  const { shipmentId, kind, otdStepId, vendorId, counterparty, currency, dueDate, lines } = req.body;

  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) return next(new AppError("Shipment not found", 404));
  assertInvoiceWritable(shipment, kind, "raise invoices against it"); // RULE-SH-12 (payables stay open on settled)

  // If a step is named, it must belong to this shipment.
  if (otdStepId) {
    const step = await prisma.otdStep.findFirst({ where: { id: otdStepId, shipmentId }, select: { id: true } });
    if (!step) return next(new AppError("Step not found on this shipment", 400));
  }
  // A payable needs to say who we owe — a vendor (preferred) or a free-text name.
  let vendorName = counterparty ?? null;
  if (kind === "payable") {
    if (vendorId) {
      const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) return next(new AppError("Vendor not found", 400));
      vendorName = vendor.name;
    } else if (!counterparty) {
      return next(new AppError("A payable invoice needs a vendor or counterparty (who we owe)", 422));
    }
  }

  // Server-side line pricing (client totals are never trusted — RULE-QT-02 style).
  const priced = lines.map((l, i) => {
    const quantity = Number(l.quantity ?? 1);
    const unitPrice = Number(l.unitPrice);
    return {
      description: l.description,
      quantity,
      unitPrice,
      amount: Math.round(quantity * unitPrice * 100) / 100,
      sortOrder: l.sortOrder ?? i,
    };
  });
  const totalAmount = Math.round(priced.reduce((s, l) => s + l.amount, 0) * 100) / 100;

  const created = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateRef(tx, "invoice");
    const invoice = await tx.invoice.create({
      data: {
        referenceNo,
        shipmentId,
        kind: kind ?? "receivable",
        otdStepId: otdStepId ?? null,
        vendorId: kind === "payable" ? vendorId ?? null : null,
        counterparty: vendorName,
        // quotationId is nullable now — manual invoices carry none.
        status: "draft",
        currency: currency ?? DEFAULT_CURRENCY,
        totalAmount,
        dueDate: dueDate ?? null,
        lines: { create: priced },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } }, payments: true },
    });
    await emitEvent(tx, "invoice.created", {
      invoiceId: invoice.id,
      referenceNo: invoice.referenceNo,
      shipmentId: invoice.shipmentId,
      kind: invoice.kind,
    });
    return invoice;
  });

  res.status(201).json({ success: true, message: `${created.kind === "payable" ? "Payable" : "Receivable"} invoice ${created.referenceNo} drafted`, data: created });
});

/* ── GET /api/finance/invoices?shipmentId= ── */
export const listInvoices = catchAsync(async (req, res) => {
  const where = {};
  if (req.query.shipmentId) where.shipmentId = req.query.shipmentId;
  if (req.query.kind) where.kind = req.query.kind;
  if (req.invoiceScope) {
    // Customer scope: own shipments AND receivables only — a customer never sees
    // what we pay our vendors.
    where.shipmentId = { in: req.invoiceScope.shipmentIds };
    where.kind = "receivable";
  }
  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { receivedAt: "desc" } },
      vendor: true,
      // The finance list links back to the job — without the ref it can only offer
      // an anonymous "Shipment" button.
      shipment: { select: { id: true, referenceNo: true, status: true } },
    },
  });
  res.json({ success: true, data: invoices });
});

/* ── GET /api/finance/invoices/:id ── */
export const getInvoice = catchAsync(async (req, res, next) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: req.params.id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { receivedAt: "desc" } },
      vendor: true,
      // The finance list links back to the job — without the ref it can only offer
      // an anonymous "Shipment" button.
      shipment: { select: { id: true, referenceNo: true, status: true } },
    },
  });
  if (!invoice || !invoiceInScope(req, invoice)) return next(new AppError("Invoice not found", 404));
  res.json({ success: true, data: invoice });
});

/* ── POST /api/finance/invoices/:id/issue ── (RULE-FI-02) */
export const issueInvoice = catchAsync(async (req, res, next) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!invoice || !invoiceInScope(req, invoice)) return next(new AppError("Invoice not found", 404));
  if (invoice.status !== "draft") return next(new AppError(`Only a draft invoice can be issued (this one is ${invoice.status})`, 409));

  const shipment = await prisma.shipment.findUnique({ where: { id: invoice.shipmentId } });
  assertInvoiceWritable(shipment, invoice.kind, "issue invoices against it"); // RULE-SH-12 (payables stay open on settled)
  const customer = shipment ? await prisma.customer.findUnique({ where: { id: shipment.customerId } }) : null;
  const termDays = customer?.creditTermsDays ?? 30;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "issued",
        issuedById: req.user.id,
        issuedAt: new Date(),
        dueDate: new Date(Date.now() + termDays * 24 * 60 * 60 * 1000),
      },
    });
    // OTC 1 belongs to the SHIPMENT, not to this invoice — it completes only
    // once no RECEIVABLE invoice is left in draft (RULE-FI-02). Payables are a
    // separate ledger and never touch OTC milestones or settlement.
    if (invoice.kind === "receivable") {
      const { unissued } = await invoiceStateTx(tx, invoice.shipmentId);
      if (unissued === 0) await completeMilestoneTx(tx, invoice.shipmentId, "invoice_issued", req.user.id);
      await maybeSettleTx(tx, invoice.shipmentId, req.user.id);
    }
    await emitEvent(tx, "invoice.issued", { invoiceId: u.id, referenceNo: u.referenceNo, shipmentId: u.shipmentId, kind: u.kind });
    return u;
  });

  const message =
    invoice.kind === "payable" ? "Payable invoice approved for payment" : "Invoice issued — OTC milestone 1 complete";
  res.json({ success: true, message, data: updated });
});

/* ── POST /api/finance/invoices/:id/payments ── (RULE-FI-03) */
export const recordPayment = catchAsync(async (req, res, next) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: req.params.id },
    include: { payments: true },
  });
  if (!invoice || !invoiceInScope(req, invoice)) return next(new AppError("Invoice not found", 404));
  if (!["issued", "part_paid"].includes(invoice.status)) {
    return next(new AppError(`Cannot record a payment against a ${invoice.status} invoice (EDGE-FI-01)`, 409));
  }

  const shipment = await prisma.shipment.findUnique({ where: { id: invoice.shipmentId } });
  assertInvoiceWritable(shipment, invoice.kind, "record payments against it"); // RULE-SH-12 (payables stay open on settled)

  const paidSoFar = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
  const newTotal = paidSoFar + Number(req.body.amount);
  const fullySettled = newTotal + 0.001 >= Number(invoice.totalAmount);

  const result = await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: req.body.amount,
        method: req.body.method,
        referenceNumber: req.body.referenceNumber ?? null,
        fxRate: req.body.fxRate ?? undefined,
        receivedAt: req.body.receivedAt ?? new Date(),
        recordedById: req.user.id,
      },
    });
    const u = await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: fullySettled ? "paid" : "part_paid" },
    });
    let ledgerClear = false;
    let shipmentStatus = shipment?.status;
    // OTC milestone 2 + settlement track the RECEIVABLE ledger only; paying a
    // payable (money out) settles nothing on the customer side.
    if (fullySettled && invoice.kind === "receivable") {
      // OTC 2 tracks the shipment's whole ledger — a second unpaid invoice must
      // keep it pending (RULE-FI-03).
      const { unpaid } = await invoiceStateTx(tx, invoice.shipmentId);
      ledgerClear = unpaid === 0;
      if (ledgerClear) await completeMilestoneTx(tx, invoice.shipmentId, "payment_received", req.user.id);
      shipmentStatus = await maybeSettleTx(tx, invoice.shipmentId, req.user.id);
      await emitEvent(tx, "payment.received", { invoiceId: invoice.id, shipmentId: invoice.shipmentId });
    }
    return { invoice: u, ledgerClear, shipmentStatus };
  });

  // Say exactly what happened — "milestone 2 complete" is a lie when another
  // invoice is still outstanding.
  let message = "Part-payment recorded";
  if (fullySettled && invoice.kind === "payable") {
    message = "Payment recorded — this payable is settled";
  } else if (fullySettled && result.shipmentStatus === "settled") {
    message = "Payment recorded — the order is now complete and locked";
  } else if (fullySettled && result.ledgerClear) {
    message = "Payment recorded — invoice settled, nothing further owed on this shipment";
  } else if (fullySettled) {
    message = "Payment recorded — this invoice is settled, but the shipment has another invoice outstanding";
  }

  res.json({ success: true, message, data: result.invoice });
});

/* ── POST /api/finance/invoices/:id/void ── (RULE-FI-05) */
export const voidInvoice = catchAsync(async (req, res, next) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { payments: true } });
  if (!invoice || !invoiceInScope(req, invoice)) return next(new AppError("Invoice not found", 404));
  if (invoice.payments.length > 0 || !["draft", "issued"].includes(invoice.status)) {
    return next(new AppError("An invoice is voidable only while unpaid (RULE-FI-05)", 409));
  }
  const shipment = await prisma.shipment.findUnique({ where: { id: invoice.shipmentId } });
  assertInvoiceWritable(shipment, invoice.kind, "void its invoices"); // RULE-SH-12 (payables stay open on settled)

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "void", voidedById: req.user.id, voidedAt: new Date(), voidReason: req.body.reason },
    });
    await emitEvent(tx, "invoice.voided", {
      invoiceId: u.id,
      referenceNo: u.referenceNo,
      shipmentId: u.shipmentId,
      kind: u.kind,
    });
    return u;
  });
  res.json({ success: true, message: "Invoice voided", data: updated });
});
