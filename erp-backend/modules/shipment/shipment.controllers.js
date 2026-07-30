import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { scopedShipmentWhere, shipmentInScope } from "./shipment.middleware.js";
import { emitShipmentEvent, auditShipment, withStepActions } from "./shipment.service.js";

/**
 * Shipment (CRM_MASTER §5.8, WORKFLOW §5.2/§11, RULE-SH).
 * Progress along the composed OTD path lives in the OTD module (§5.9); status is
 * derived, never written here (ADR-014, INV-02). This module owns shipment-level
 * reads and the exception lifecycle — hold/resume/cancel/close — which is
 * orthogonal to progress (RULE-SH-08).
 */

const hydrate = async (shipments) => {
  const customerIds = [...new Set(shipments.map((s) => s.customerId))];
  const customers = await prisma.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, referenceNo: true, companyId: true },
  });
  const companies = await prisma.company.findMany({
    where: { id: { in: customers.map((c) => c.companyId) } },
    select: { id: true, name: true },
  });
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const custById = new Map(customers.map((c) => [c.id, c]));
  return shipments.map((s) => {
    const c = custById.get(s.customerId);
    return {
      ...s,
      customerRef: c?.referenceNo ?? "—",
      customerCompany: c ? companyName.get(c.companyId) ?? "—" : "—",
    };
  });
};

const num = (v) => (v == null ? 0 : Number(v));
// Convert an amount into the shipment/quotation base currency via its fxRate.
const inBase = (amount, fxRate) => num(amount) * (fxRate == null ? 1 : Number(fxRate));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* ── GET /api/shipments/:id/pnl ── */
// Invoices are the single money record on a job, so actuals come straight off the
// two invoice ledgers: receivables are revenue, payables are cost. The *estimate*
// has no invoice to sit on — it comes from the approved quotation, whose sell
// lines are what we quoted and whose cost sheet is what we expected to pay.
export const getShipmentPnl = catchAsync(async (req, res, next) => {
  const shipmentId = req.params.id;
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: { id: true, quotationId: true },
  });
  if (!shipment || !(await shipmentInScope(req, shipment))) return next(new AppError("Shipment not found", 404));

  const [invoices, quotation] = await Promise.all([
    prisma.invoice.findMany({
      where: { shipmentId, status: { not: "void" } },
      select: { kind: true, status: true, totalAmount: true, currency: true, fxRate: true, payments: { select: { amount: true } } },
    }),
    prisma.quotation.findUnique({
      where: { id: shipment.quotationId },
      select: { currency: true, fxRate: true, chargeLines: { select: { amount: true, costAmount: true } } },
    }),
  ]);

  const qFx = quotation?.fxRate ?? null;
  const quoted = {
    // Sell side — what the customer accepted.
    revenue: round2((quotation?.chargeLines ?? []).reduce((s, l) => s + inBase(l.amount, qFx), 0)),
    // Buy side — the internal cost sheet. Lines left blank simply don't contribute.
    cost: round2((quotation?.chargeLines ?? []).reduce((s, l) => s + inBase(l.costAmount, qFx), 0)),
  };

  const side = (kind) => {
    const rows = invoices.filter((i) => (i.kind ?? "receivable") === kind);
    const invoiced = rows.reduce((s, i) => s + inBase(i.totalAmount, i.fxRate), 0);
    const collected = rows.reduce(
      (s, i) => s + inBase(i.payments.reduce((ps, p) => ps + num(p.amount), 0), i.fxRate),
      0,
    );
    return { invoiced: round2(invoiced), collected: round2(collected) };
  };

  const revenue = side("receivable");
  const cost = side("payable");
  // Anything invoiced but not yet fully paid on the buy side.
  const openPayables = invoices.filter(
    (i) => (i.kind ?? "receivable") === "payable" && i.status !== "paid",
  );
  const currencies = [...new Set(invoices.map((i) => i.currency).filter(Boolean))];

  res.json({
    success: true,
    data: {
      // `actual` = invoiced. Until a job is invoiced it reads 0, which is the
      // honest answer — the estimate alongside it carries the expectation.
      revenue: { estimated: quoted.revenue, actual: revenue.invoiced, invoiced: revenue.invoiced, collected: revenue.collected },
      cost: { estimated: quoted.cost, actual: cost.invoiced, invoiced: cost.invoiced, paid: cost.collected },
      margin: {
        estimated: round2(quoted.revenue - quoted.cost),
        actual: round2(revenue.invoiced - cost.invoiced),
      },
      openPayables: {
        count: openPayables.length,
        amount: round2(
          openPayables.reduce(
            (s, i) => s + inBase(num(i.totalAmount) - i.payments.reduce((ps, p) => ps + num(p.amount), 0), i.fxRate),
            0,
          ),
        ),
      },
      mixedCurrency: currencies.length > 1,
      currencies,
    },
  });
});

/* ── GET /api/shipments?status=&exceptionState= ── */
export const listShipments = catchAsync(async (req, res) => {
  const extra = {};
  if (req.query.status) extra.status = req.query.status;
  if (req.query.exceptionState) extra.exceptionState = req.query.exceptionState;
  const where = scopedShipmentWhere(req, extra);
  const shipments = await prisma.shipment.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json({ success: true, data: await hydrate(shipments) });
});

/* ── GET /api/shipments/:id ── (full detail) */
export const getShipment = catchAsync(async (req, res, next) => {
  const shipment = await prisma.shipment.findUnique({
    where: { id: req.params.id },
    include: {
      otdSteps: { orderBy: { displayNo: "asc" } },
      otcMilestones: { orderBy: { milestoneNo: "asc" } },
      exceptions: { orderBy: { raisedAt: "desc" } },
      invoices: {
        orderBy: { createdAt: "desc" },
        include: {
          payments: { orderBy: { receivedAt: "desc" } }, // for the OTC payment-tracking view
          lines: { orderBy: { sortOrder: "asc" } }, // what the invoice is actually billing for
          vendor: { select: { id: true, name: true } }, // payables name who we owe
        },
      },
    },
  });
  if (!shipment || !(await shipmentInScope(req, shipment))) return next(new AppError("Shipment not found", 404));

  // Portal customers never see the payable (vendor cost) side of the ledger.
  if (req.user?.customerId) {
    shipment.invoices = shipment.invoices.filter((i) => i.kind === "receivable");
  }

  // Each step's sub-action checklist, with document items resolved against the files
  // actually on record (ADR-048) — the stepper renders progress straight from this.
  shipment.otdSteps = await withStepActions(prisma, shipment.id, shipment.otdSteps);

  const channel = await prisma.chatChannel.findUnique({
    where: { shipmentId: shipment.id },
    select: { id: true },
  });
  const [hydrated] = await hydrate([shipment]);
  res.json({ success: true, data: { ...hydrated, chatChannelId: channel?.id ?? null } });
});

/* ── POST /api/shipments/:id/hold ── (RULE-SH-08/09, WORKFLOW §11) */
export const holdShipment = catchAsync(async (req, res, next) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment || !(await shipmentInScope(req, shipment))) return next(new AppError("Shipment not found", 404));
  if (shipment.exceptionState !== "none") {
    return next(new AppError(`Shipment is already ${shipment.exceptionState}`, 409));
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({ where: { id: shipment.id }, data: { exceptionState: "on_hold" } });
    await tx.shipmentException.create({
      data: { shipmentId: shipment.id, type: req.body.type, reason: req.body.reason, raisedById: req.user.id },
    });
    // Freeze open tasks — clocks stop (ADR-038); a task is held iff sla_paused_at set.
    const openTasks = await tx.task.findMany({
      where: { shipmentId: shipment.id, status: { in: ["queued", "open", "in_progress"] } },
    });
    const now = new Date();
    for (const t of openTasks) {
      await tx.task.update({
        where: { id: t.id },
        data: { status: "on_hold", statusBeforeHold: t.status, slaPausedAt: now },
      });
    }
    await auditShipment(tx, {
      actorId: req.user.id,
      action: "shipment.hold",
      resourceType: "shipment",
      resourceId: shipment.id,
      diff: { type: req.body.type, reason: req.body.reason },
    });
    await emitShipmentEvent(tx, "shipment.held", { shipmentId: shipment.id, type: req.body.type });
  });

  res.json({ success: true, message: "Shipment placed on hold — SLA clocks stopped" });
});

/* ── POST /api/shipments/:id/resume ── (RULE-SH-10, ADR-038) */
export const resumeShipment = catchAsync(async (req, res, next) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment || !(await shipmentInScope(req, shipment))) return next(new AppError("Shipment not found", 404));
  if (shipment.exceptionState !== "on_hold") return next(new AppError("Shipment is not on hold", 409));

  await prisma.$transaction(async (tx) => {
    const exception = await tx.shipmentException.findFirst({
      where: { shipmentId: shipment.id, resolvedAt: null },
      orderBy: { raisedAt: "desc" },
    });
    const now = new Date();
    const holdMinutes = exception ? Math.round((now - exception.raisedAt) / 60000) : 0;

    if (exception) {
      await tx.shipmentException.update({
        where: { id: exception.id },
        data: { resolvedById: req.user.id, resolvedAt: now, resolutionNotes: req.body.resolutionNotes, holdMinutes },
      });
    }
    await tx.shipment.update({
      where: { id: shipment.id },
      data: { exceptionState: "none", totalHoldMinutes: { increment: holdMinutes } },
    });
    // Thaw tasks — restore prior status and shift due dates by the hold duration.
    const heldTasks = await tx.task.findMany({ where: { shipmentId: shipment.id, slaPausedAt: { not: null } } });
    for (const t of heldTasks) {
      await tx.task.update({
        where: { id: t.id },
        data: {
          status: t.statusBeforeHold ?? "open",
          statusBeforeHold: null,
          slaPausedAt: null,
          dueDate: t.dueDate ? new Date(t.dueDate.getTime() + holdMinutes * 60000) : t.dueDate,
        },
      });
    }
    await auditShipment(tx, {
      actorId: req.user.id,
      action: "shipment.resume",
      resourceType: "shipment",
      resourceId: shipment.id,
      diff: { holdMinutes },
    });
    await emitShipmentEvent(tx, "shipment.resumed", { shipmentId: shipment.id, holdMinutes });
  });

  res.json({ success: true, message: "Shipment resumed — task due dates shifted by the hold duration" });
});

/* ── PATCH /api/shipments/:id/schedule ── (ETD/ETA — WORKFLOW §14 ETA-breach) */
export const setSchedule = catchAsync(async (req, res, next) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment || !(await shipmentInScope(req, shipment))) return next(new AppError("Shipment not found", 404));
  if (["settled", "closed"].includes(shipment.status) || shipment.exceptionState === "cancelled") {
    return next(new AppError("The schedule of a finished or cancelled shipment cannot change", 409));
  }

  const data = {};
  if (req.body.etd) data.etd = req.body.etd;
  if (req.body.eta) data.eta = req.body.eta;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.shipment.update({ where: { id: shipment.id }, data });
    await auditShipment(tx, {
      actorId: req.user.id,
      action: "shipment.schedule",
      resourceType: "shipment",
      resourceId: shipment.id,
      diff: { etd: data.etd ?? shipment.etd, eta: data.eta ?? shipment.eta },
    });
    await emitShipmentEvent(tx, "shipment.scheduled", {
      shipmentId: shipment.id,
      customerId: shipment.customerId ?? null,
      etd: u.etd,
      eta: u.eta,
    });
    return u;
  });

  res.json({ success: true, message: "Schedule updated", data: { etd: updated.etd, eta: updated.eta } });
});

/* ── POST /api/shipments/:id/cancel ── (RULE-SH-11) */
export const cancelShipment = catchAsync(async (req, res, next) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment || !(await shipmentInScope(req, shipment))) return next(new AppError("Shipment not found", 404));
  if (["closed", "settled"].includes(shipment.status) || shipment.exceptionState === "cancelled") {
    return next(new AppError("Shipment cannot be cancelled at this stage", 409));
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipment.id },
      data: { exceptionState: "cancelled", cancelReason: req.body.reason },
    });
    await tx.task.updateMany({
      where: { shipmentId: shipment.id, status: { in: ["queued", "open", "in_progress", "on_hold"] } },
      data: { status: "cancelled", cancelReason: "Shipment cancelled" },
    });
    // Void unpaid invoices (RULE-SH-11 / RULE-FI-05).
    await tx.invoice.updateMany({
      where: { shipmentId: shipment.id, status: { in: ["draft", "issued", "part_paid"] } },
      data: { status: "void", voidedById: req.user.id, voidedAt: new Date(), voidReason: "Shipment cancelled" },
    });
    await auditShipment(tx, {
      actorId: req.user.id,
      action: "shipment.cancel",
      resourceType: "shipment",
      resourceId: shipment.id,
      diff: { reason: req.body.reason },
    });
    await emitShipmentEvent(tx, "shipment.cancelled", { shipmentId: shipment.id, reason: req.body.reason });
  });

  res.json({ success: true, message: "Shipment cancelled — open tasks cancelled and unpaid invoices voided" });
});

/* ── POST /api/shipments/:id/close ── (RULE-SH-12) */
export const closeShipment = catchAsync(async (req, res, next) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment || !(await shipmentInScope(req, shipment))) return next(new AppError("Shipment not found", 404));
  if (shipment.status !== "settled") {
    return next(new AppError("Only a settled shipment can be closed", 409));
  }

  // Closing locks the payable ledger too — surface any still-open vendor bills so
  // closure is a deliberate act (they don't block settlement, but they do close).
  const openPayables = await prisma.invoice.aggregate({
    where: { shipmentId: shipment.id, kind: "payable", status: { notIn: ["paid", "void"] } },
    _count: true,
    _sum: { totalAmount: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipment.id },
      data: { status: "closed", closedById: req.user.id, closedAt: new Date() },
    });
    // A closed shipment must not keep residual open tasks generating false
    // overdue escalations (RULE-AE-06 / RULE-SH-12).
    await tx.task.updateMany({
      where: { shipmentId: shipment.id, status: { in: ["queued", "open", "in_progress", "on_hold"] } },
      data: { status: "cancelled", cancelReason: "Shipment closed" },
    });
    await tx.shipmentStatusHistory.create({
      data: { shipmentId: shipment.id, fromStatus: "settled", toStatus: "closed", actorId: req.user.id },
    });
    await auditShipment(tx, {
      actorId: req.user.id,
      action: "shipment.close",
      resourceType: "shipment",
      resourceId: shipment.id,
      diff: { openPayableCount: openPayables._count, openPayableAmount: openPayables._sum.totalAmount ?? 0 },
    });
    await emitShipmentEvent(tx, "shipment.closed", { shipmentId: shipment.id });
  });

  const closeMsg = openPayables._count > 0
    ? `Shipment closed — note ${openPayables._count} open payable(s) were locked at close`
    : "Shipment closed";
  res.json({ success: true, message: closeMsg, data: { openPayables: { count: openPayables._count, amount: openPayables._sum.estimatedAmount ?? 0 } } });
});
