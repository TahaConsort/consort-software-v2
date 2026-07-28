import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { assertPayableWritable, assertShipmentUnlocked } from "../shipment/shipment.service.js";

/**
 * Job-charge ledger (freight-forwarding OTC upgrade). One row per expected/actual
 * money movement on a shipment — the source of per-step money, job P&L, and
 * invoice generation. Receivable charges imply the customer; payable charges name
 * a vendor. Read: `charge.read`; create/confirm/cancel: `charge.create`/`charge.confirm`.
 */

const includeRels = { chargeType: true, vendor: true, otdStep: { select: { id: true, displayNo: true, stepCode: true } } };

const num = (v) => (v == null ? 0 : Number(v));
// Convert a charge amount into the shipment/quotation base currency via its fxRate.
const inBase = (amount, fxRate) => num(amount) * (fxRate == null ? 1 : Number(fxRate));

/* ── GET /api/charges/types ── (ChargeType catalog for dropdowns) */
export const listChargeTypes = catchAsync(async (req, res) => {
  const types = await prisma.chargeType.findMany({ where: { isActive: true }, orderBy: { label: "asc" } });
  res.json({ success: true, data: types });
});

/* ── GET /api/charges?shipmentId=&direction=&status=&vendorId= ── */
export const listCharges = catchAsync(async (req, res) => {
  const { shipmentId, direction, status, vendorId } = req.query;
  const where = {
    ...(shipmentId ? { shipmentId } : {}),
    ...(direction ? { direction } : {}),
    ...(status ? { status } : {}),
    ...(vendorId ? { vendorId } : {}),
  };
  const charges = await prisma.shipmentCharge.findMany({ where, orderBy: { createdAt: "asc" }, include: includeRels });
  res.json({ success: true, data: charges });
});

/* ── POST /api/charges ── (ad-hoc charge, e.g. demurrage discovered mid-job) */
export const createCharge = catchAsync(async (req, res, next) => {
  const b = req.body;
  const shipment = await prisma.shipment.findUnique({ where: { id: b.shipmentId } });
  if (!shipment) return next(new AppError("Shipment not found", 404));
  // Payable charges stay writable on a settled shipment; receivables lock at settle.
  if (b.direction === "payable") assertPayableWritable(shipment, "add vendor charges");
  else assertShipmentUnlocked(shipment, "add charges");

  const chargeType = await prisma.chargeType.findUnique({ where: { code: b.chargeCode } });
  if (!chargeType) return next(new AppError("Unknown charge type", 400));

  if (b.otdStepId) {
    const step = await prisma.otdStep.findFirst({ where: { id: b.otdStepId, shipmentId: b.shipmentId }, select: { id: true } });
    if (!step) return next(new AppError("Step not found on this shipment", 400));
  }
  if (b.direction === "payable" && b.vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: b.vendorId } });
    if (!vendor) return next(new AppError("Vendor not found", 400));
  }

  const charge = await prisma.shipmentCharge.create({
    data: {
      shipmentId: b.shipmentId,
      otdStepId: b.otdStepId ?? null,
      chargeCode: b.chargeCode,
      direction: b.direction,
      vendorId: b.direction === "payable" ? b.vendorId ?? null : null,
      description: b.description ?? null,
      currency: b.currency ?? "USD",
      fxRate: b.fxRate ?? undefined,
      estimatedAmount: b.estimatedAmount,
      actualAmount: b.actualAmount ?? undefined,
      status: b.actualAmount != null ? "confirmed" : "estimated",
      confirmedById: b.actualAmount != null ? req.user.id : undefined,
      confirmedAt: b.actualAmount != null ? new Date() : undefined,
      createdById: req.user.id,
    },
    include: includeRels,
  });
  res.status(201).json({ success: true, message: "Charge added", data: charge });
});

/* ── PATCH /api/charges/:id/confirm ── (commit the actual amount) */
export const confirmCharge = catchAsync(async (req, res, next) => {
  const charge = await prisma.shipmentCharge.findUnique({ where: { id: req.params.id } });
  if (!charge) return next(new AppError("Charge not found", 404));
  if (!["estimated", "confirmed"].includes(charge.status)) {
    return next(new AppError(`A ${charge.status} charge can no longer be confirmed`, 409));
  }
  const vendorId = req.body.vendorId ?? charge.vendorId;
  if (charge.direction === "payable" && !vendorId) {
    return next(new AppError("A payable charge needs a vendor before it can be confirmed", 422));
  }
  if (req.body.vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.body.vendorId } });
    if (!vendor) return next(new AppError("Vendor not found", 400));
  }

  const updated = await prisma.shipmentCharge.update({
    where: { id: charge.id },
    data: {
      status: "confirmed",
      actualAmount: req.body.actualAmount,
      vendorId: charge.direction === "payable" ? vendorId : null,
      fxRate: req.body.fxRate ?? charge.fxRate ?? undefined,
      confirmedById: req.user.id,
      confirmedAt: new Date(),
    },
    include: includeRels,
  });
  res.json({ success: true, message: "Charge confirmed", data: updated });
});

/* ── PATCH /api/charges/:id/cancel ── */
export const cancelCharge = catchAsync(async (req, res, next) => {
  const charge = await prisma.shipmentCharge.findUnique({ where: { id: req.params.id } });
  if (!charge) return next(new AppError("Charge not found", 404));
  if (["invoiced", "settled"].includes(charge.status)) {
    return next(new AppError("A billed charge can't be cancelled — void its invoice first", 409));
  }
  const updated = await prisma.shipmentCharge.update({
    where: { id: charge.id },
    data: { status: "cancelled", cancelReason: req.body.reason },
    include: includeRels,
  });
  res.json({ success: true, message: "Charge cancelled", data: updated });
});

/* ── GET /api/shipments/:id/pnl ── (mounted on the shipments router) */
export const getShipmentPnl = catchAsync(async (req, res, next) => {
  const shipmentId = req.params.id;
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true } });
  if (!shipment) return next(new AppError("Shipment not found", 404));

  const charges = await prisma.shipmentCharge.findMany({
    where: { shipmentId, status: { not: "cancelled" } },
    select: { direction: true, status: true, estimatedAmount: true, actualAmount: true, fxRate: true, currency: true },
  });
  const invoices = await prisma.invoice.findMany({
    where: { shipmentId, status: { not: "void" } },
    select: { kind: true, status: true, totalAmount: true, fxRate: true, payments: { select: { amount: true } } },
  });

  const side = (direction) => {
    const rows = charges.filter((c) => c.direction === direction);
    const estimated = rows.reduce((s, c) => s + inBase(c.estimatedAmount, c.fxRate), 0);
    // Actual = confirmed amount where set, else the estimate (best current view).
    const actual = rows.reduce((s, c) => s + inBase(c.actualAmount ?? c.estimatedAmount, c.fxRate), 0);
    const kind = direction === "receivable" ? "receivable" : "payable";
    const inv = invoices.filter((i) => i.kind === kind);
    const invoiced = inv.reduce((s, i) => s + inBase(i.totalAmount, i.fxRate), 0);
    const collected = inv.reduce((s, i) => s + i.payments.reduce((ps, p) => ps + num(p.amount), 0) * (i.fxRate == null ? 1 : Number(i.fxRate)), 0);
    return { estimated: round2(estimated), actual: round2(actual), invoiced: round2(invoiced), collected: round2(collected) };
  };

  const revenue = side("receivable");
  const cost = side("payable");
  const openPayables = charges.filter((c) => c.direction === "payable" && !["settled", "cancelled"].includes(c.status));
  const currencies = [...new Set(charges.map((c) => c.currency))];

  res.json({
    success: true,
    data: {
      revenue: { estimated: revenue.estimated, actual: revenue.actual, invoiced: revenue.invoiced, collected: revenue.collected },
      cost: { estimated: cost.estimated, actual: cost.actual, invoiced: cost.invoiced, paid: cost.collected },
      margin: { estimated: round2(revenue.estimated - cost.estimated), actual: round2(revenue.actual - cost.actual) },
      openPayables: {
        count: openPayables.length,
        amount: round2(openPayables.reduce((s, c) => s + inBase(c.actualAmount ?? c.estimatedAmount, c.fxRate), 0)),
      },
      mixedCurrency: currencies.length > 1,
      currencies,
    },
  });
});

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
