import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { scopedShipmentWhere, shipmentInScope } from "./shipment.middleware.js";
import {
  emitShipmentEvent,
  auditShipment,
  withStepActions,
  assertShipmentUnlocked,
  assertOpsOwner,
  seedShipmentParties,
} from "./shipment.service.js";
import { PARTY_CONFIDENTIAL_FIELDS, EXPECTED_EXPORT_ROLES } from "../../utils/partyRoles.js";

/**
 * Shipment (CRM_MASTER §5.8, WORKFLOW §5.2/§11, RULE-SH).
 * Progress along the composed OTD path lives in the OTD module (§5.9); status is
 * derived, never written here (ADR-014, INV-02). This module owns shipment-level
 * reads and the exception lifecycle — hold/resume/cancel/close — which is
 * orthogonal to progress (RULE-SH-08).
 */

const hydrate = async (shipments) => {
  const customerIds = [...new Set(shipments.map((s) => s.customerId))];
  const ownerIds = [...new Set(shipments.map((s) => s.opsOwnerId).filter(Boolean))];
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
      })
    : [];
  const ownerById = new Map(owners.map((u) => [u.id, u]));
  const ownerNameOf = (id) => {
    const u = ownerById.get(id);
    return u?.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u?.email ?? null;
  };
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
      opsOwnerName: s.opsOwnerId ? ownerNameOf(s.opsOwnerId) : null,
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

  const [invoices, quotation, tradeInvoices] = await Promise.all([
    prisma.invoice.findMany({
      where: { shipmentId, status: { not: "void" } },
      select: { kind: true, status: true, totalAmount: true, currency: true, fxRate: true, payments: { select: { amount: true } } },
    }),
    // A trade shipment has no quotation (roadmap Step 1), so this is simply null and
    // the estimate reads 0 — the goods figures below carry the picture instead.
    shipment.quotationId
      ? prisma.quotation.findUnique({
          where: { id: shipment.quotationId },
          select: { currency: true, fxRate: true, chargeLines: { select: { amount: true, costAmount: true } } },
        })
      : null,
    // Goods economics (decision #1): what Consort sells the cargo for, less what it
    // paid the vendor for it. Distinct from the freight margin above, which is the
    // service side of the same job.
    prisma.tradeInvoice.findMany({
      where: { shipmentId, status: "issued" },
      select: { side: true, totalValue: true, currency: true },
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

  // Goods side. No FX conversion here: a trade shipment is invoiced in one currency on
  // both legs (the sample set is EUR throughout), and inventing a rate would be worse
  // than reporting the figures as they were billed.
  const goodsRevenue = round2(
    tradeInvoices.filter((t) => t.side === "sale").reduce((s, t) => s + num(t.totalValue), 0),
  );
  const goodsCost = round2(
    tradeInvoices.filter((t) => t.side === "purchase").reduce((s, t) => s + num(t.totalValue), 0),
  );
  const goodsCurrencies = [...new Set(tradeInvoices.map((t) => t.currency).filter(Boolean))];

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
      // Present only when the shipment actually trades goods; a forwarding job leaves
      // this null rather than showing three zeroes that mean nothing.
      goods: tradeInvoices.length
        ? {
            revenue: goodsRevenue,
            cost: goodsCost,
            margin: round2(goodsRevenue - goodsCost),
            currencies: goodsCurrencies,
            mixedCurrency: goodsCurrencies.length > 1,
          }
        : null,
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
  // Ops ownership filters for the list toolbar: "me" is my desk, "none" the
  // claimable pool. Anything else is read as a literal user id.
  if (req.query.opsOwnerId === "me") extra.opsOwnerId = req.user.id;
  else if (req.query.opsOwnerId === "none") extra.opsOwnerId = null;
  else if (req.query.opsOwnerId) extra.opsOwnerId = req.query.opsOwnerId;
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
  await assertOpsOwner(req, shipment, "put it on hold");
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
  await assertOpsOwner(req, shipment, "resume it");
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
  await assertOpsOwner(req, shipment, "change its schedule");
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
  await assertOpsOwner(req, shipment, "cancel it");
  if (["closed", "settled"].includes(shipment.status) || shipment.exceptionState === "cancelled") {
    return next(new AppError("Shipment cannot be cancelled at this stage", 409));
  }

  let unwound = false;
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

    // Unwind the enquiry when the order never locked (ADR-056). Before Order Lock there
    // is no verified signed Rate Confirmation — the customer never countersigned the
    // order — so a cancellation here means the acceptance did not hold. Leaving the
    // quotation `approved` and the query `shipment_created` stranded the enquiry: INV-08
    // blocked any re-quote. The quotation becomes `rejected` with the reason on it and
    // the query returns to `revision_requested`, exactly as a customer rejection does.
    // After Order Lock the customer DID sign; that is a real cancellation, left as is.
    if (shipment.quotationId) {
      const orderLock = await tx.otdStep.findFirst({
        where: { shipmentId: shipment.id, stepCode: "order_lock" },
        select: { status: true },
      });
      if (orderLock && orderLock.status !== "done") {
        const quotation = await tx.quotation.findUnique({ where: { id: shipment.quotationId } });
        if (quotation?.status === "approved") {
          await tx.quotation.update({
            where: { id: quotation.id },
            data: {
              status: "rejected",
              rejectionReason: `Shipment cancelled before Order Lock: ${req.body.reason}`,
              rowVersion: { increment: 1 },
            },
          });
          await tx.query.update({ where: { id: quotation.queryId }, data: { status: "revision_requested" } });
          await tx.auditLog.create({
            data: {
              actorId: req.user.id,
              action: "quotation.unwound",
              resourceType: "quotation",
              resourceId: quotation.id,
              diff: { shipmentId: shipment.id, reason: req.body.reason },
              correlationId: crypto.randomUUID(),
            },
          });
          unwound = true;
        }
      }
    }

    await auditShipment(tx, {
      actorId: req.user.id,
      action: "shipment.cancel",
      resourceType: "shipment",
      resourceId: shipment.id,
      diff: { reason: req.body.reason, unwound },
    });
    await emitShipmentEvent(tx, "shipment.cancelled", { shipmentId: shipment.id, reason: req.body.reason, unwound });
  });

  res.json({
    success: true,
    message: unwound
      ? "Shipment cancelled — open tasks cancelled, unpaid invoices voided, and the enquiry reopened for a new quote"
      : "Shipment cancelled — open tasks cancelled and unpaid invoices voided",
    data: { unwound },
  });
});

/* ── POST /api/shipments/:id/close ── (RULE-SH-12) */
export const closeShipment = catchAsync(async (req, res, next) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment || !(await shipmentInScope(req, shipment))) return next(new AppError("Shipment not found", 404));
  await assertOpsOwner(req, shipment, "close it");
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

/* ══════════════════════════════════════════════════════════════════════════════
 * Per-shipment party roles (Export Shipment Workflow roadmap §2/§3/§7)
 *
 * The roadmap's core modelling rule: a party's contact and banking details live once
 * on the party record, while the ROLE is per shipment. `Vendor.type` stays a default
 * hint for the picker and is never consulted here — any party may hold any role, which
 * is exactly what lets Consort be Manufacturer on an export and Freight Forwarder on
 * an import (roadmap §1, Examples 1 & 2).
 * ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Load the shipment for a party operation, or fail the way the rest of the module
 * does: out of scope reads 404, never 403 (BUSINESS_RULES §2.3).
 */
const loadShipmentForParty = async (req) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment || !(await shipmentInScope(req, shipment))) return null;
  return shipment;
};

/**
 * Attach each party's identity to its row. Bank and tax fields are stripped for a
 * portal customer: a trade shipment carries the vendor's IBAN and NTN alongside the
 * customer's own record, and none of that is theirs to see (ADR-047, portal containment).
 */
const hydrateParties = async (rows, viewerIsCustomer) => {
  const vendorIds = [...new Set(rows.map((r) => r.vendorId).filter(Boolean))];
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];

  const [vendors, customers] = await Promise.all([
    vendorIds.length
      ? prisma.vendor.findMany({
          where: { id: { in: vendorIds } },
          select: {
            id: true, referenceNo: true, name: true, type: true, isActive: true,
            contactName: true, email: true, phone: true, address: true, city: true, country: true,
            taxId: true, strn: true, rexNo: true, vatNo: true,
            bankName: true, bankBranch: true, iban: true, swiftCode: true, accountTitle: true,
            paymentTermsDays: true, currency: true,
          },
        })
      : [],
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, referenceNo: true, companyId: true },
        })
      : [],
  ]);

  // `Customer` carries a scalar company_id with no Prisma relation field, so the company
  // is a second lookup — the same two-step the module's own hydrate() does.
  const companies = customers.length
    ? await prisma.company.findMany({
        where: { id: { in: [...new Set(customers.map((c) => c.companyId))] } },
        select: { id: true, name: true, country: true, city: true, address: true },
      })
    : [];

  const vById = new Map(vendors.map((v) => [v.id, v]));
  const cById = new Map(customers.map((c) => [c.id, c]));
  const coById = new Map(companies.map((c) => [c.id, c]));

  return rows.map((r) => {
    if (r.vendorId) {
      const v = vById.get(r.vendorId);
      const party = v ? { ...v } : null;
      if (party && viewerIsCustomer) for (const f of PARTY_CONFIDENTIAL_FIELDS) delete party[f];
      return { ...r, partyKind: "vendor", party };
    }
    const c = cById.get(r.customerId);
    const co = c ? coById.get(c.companyId) : null;
    return {
      ...r,
      partyKind: "customer",
      party: c
        ? { id: c.id, referenceNo: c.referenceNo, name: co?.name ?? "—", country: co?.country ?? null, city: co?.city ?? null, address: co?.address ?? null }
        : null,
    };
  });
};

/* ── GET /api/shipments/:id/parties ── */
export const listShipmentParties = catchAsync(async (req, res, next) => {
  const shipment = await loadShipmentForParty(req);
  if (!shipment) return next(new AppError("Shipment not found", 404));

  const rows = await prisma.shipmentParty.findMany({
    where: { shipmentId: shipment.id },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  const parties = await hydrateParties(rows, req.user.role === "customer");

  // Which roadmap roles are still unfilled — reported, never enforced: a shipment is
  // assembled over weeks and the carrier is unknown when the contract is signed. Every
  // shipment on the roadmap path expects them (ADR-057), whichever kind it was born as
  // — a contract-born shipment always is; a quotation-born one is once it carries the
  // roadmap steps. A shipment frozen on the retired forwarding path is left alone.
  const onRoadmap =
    shipment.kind === "trade" ||
    !!(await prisma.otdStep.findFirst({
      where: { shipmentId: shipment.id, stepCode: { startsWith: "trade_" } },
      select: { id: true },
    }));
  const filled = new Set(rows.map((r) => r.role));
  const missingRoles = onRoadmap ? EXPECTED_EXPORT_ROLES.filter((r) => !filled.has(r)) : [];

  res.json({ success: true, data: { shipmentId: shipment.id, parties, missingRoles } });
});

/* ── POST /api/shipments/:id/parties ── */
export const addShipmentParty = catchAsync(async (req, res, next) => {
  const shipment = await loadShipmentForParty(req);
  if (!shipment) return next(new AppError("Shipment not found", 404));
  assertShipmentUnlocked(shipment, "change its parties");
  await assertOpsOwner(req, shipment, "change its parties");

  const { role, vendorId, customerId, notes } = req.body;

  // Resolve the target first so a bad id is a clean 404 rather than an FK violation.
  if (vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, isActive: true, name: true } });
    if (!vendor) return next(new AppError("Vendor not found", 404));
    if (!vendor.isActive) {
      return next(new AppError(vendor.name + " is deactivated — reactivate it before putting it on a shipment", 409));
    }
  } else {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) return next(new AppError("Customer not found", 404));
  }

  const duplicate = await prisma.shipmentParty.findFirst({
    where: { shipmentId: shipment.id, role, vendorId: vendorId ?? null, customerId: customerId ?? null },
    select: { id: true },
  });
  if (duplicate) return next(new AppError("That party already holds this role on this shipment", 409));

  const created = await prisma.$transaction(async (tx) => {
    const party = await tx.shipmentParty.create({
      data: { shipmentId: shipment.id, role, vendorId: vendorId ?? null, customerId: customerId ?? null, notes: notes ?? null },
    });
    await auditShipment(tx, {
      actorId: req.user.id,
      action: "shipment.party.added",
      resourceType: "shipment_party",
      resourceId: party.id,
      diff: { shipmentId: shipment.id, role, vendorId: vendorId ?? null, customerId: customerId ?? null },
    });
    await emitShipmentEvent(tx, "shipment.parties.changed", { shipmentId: shipment.id, role });
    return party;
  });

  const [hydrated] = await hydrateParties([created], req.user.role === "customer");
  res.status(201).json({ success: true, message: "Party added", data: hydrated });
});

/* ── PATCH /api/shipments/:id/parties/:partyId ── */
export const updateShipmentParty = catchAsync(async (req, res, next) => {
  const shipment = await loadShipmentForParty(req);
  if (!shipment) return next(new AppError("Shipment not found", 404));
  assertShipmentUnlocked(shipment, "change its parties");
  await assertOpsOwner(req, shipment, "change its parties");

  const existing = await prisma.shipmentParty.findFirst({
    where: { id: req.params.partyId, shipmentId: shipment.id },
  });
  if (!existing) return next(new AppError("Party not found on this shipment", 404));

  const data = {};
  if (req.body.role !== undefined) data.role = req.body.role;
  if (req.body.notes !== undefined) data.notes = req.body.notes;

  if (data.role && data.role !== existing.role) {
    const clash = await prisma.shipmentParty.findFirst({
      where: {
        shipmentId: shipment.id,
        role: data.role,
        vendorId: existing.vendorId,
        customerId: existing.customerId,
        id: { not: existing.id },
      },
      select: { id: true },
    });
    if (clash) return next(new AppError("That party already holds this role on this shipment", 409));
  }

  const updated = await prisma.$transaction(async (tx) => {
    const party = await tx.shipmentParty.update({ where: { id: existing.id }, data });
    await auditShipment(tx, {
      actorId: req.user.id,
      action: "shipment.party.updated",
      resourceType: "shipment_party",
      resourceId: party.id,
      diff: {
        shipmentId: shipment.id,
        before: { role: existing.role, notes: existing.notes },
        after: { role: party.role, notes: party.notes },
      },
    });
    await emitShipmentEvent(tx, "shipment.parties.changed", { shipmentId: shipment.id, role: party.role });
    return party;
  });

  const [hydrated] = await hydrateParties([updated], req.user.role === "customer");
  res.json({ success: true, message: "Party updated", data: hydrated });
});

/* ── DELETE /api/shipments/:id/parties/:partyId ── */
export const removeShipmentParty = catchAsync(async (req, res, next) => {
  const shipment = await loadShipmentForParty(req);
  if (!shipment) return next(new AppError("Shipment not found", 404));
  assertShipmentUnlocked(shipment, "change its parties");
  await assertOpsOwner(req, shipment, "change its parties");

  const existing = await prisma.shipmentParty.findFirst({
    where: { id: req.params.partyId, shipmentId: shipment.id },
  });
  if (!existing) return next(new AppError("Party not found on this shipment", 404));

  await prisma.$transaction(async (tx) => {
    await tx.shipmentParty.delete({ where: { id: existing.id } });
    await auditShipment(tx, {
      actorId: req.user.id,
      action: "shipment.party.removed",
      resourceType: "shipment_party",
      resourceId: existing.id,
      diff: { shipmentId: shipment.id, role: existing.role, vendorId: existing.vendorId, customerId: existing.customerId },
    });
    await emitShipmentEvent(tx, "shipment.parties.changed", { shipmentId: shipment.id, role: existing.role });
  });

  res.json({ success: true, message: "Party removed" });
});

/* ── POST /api/shipments/:id/claim ── (ops ownership, 2026-09-08) */
/**
 * Take ownership of an unclaimed shipment. From here only the claimer runs its
 * operations steps, schedule, parties, trade documents and money — the same
 * "mine or nobody's" shape Sales already uses for queries. Idempotent for the
 * current owner so a double-click is harmless.
 */
export const claimShipment = catchAsync(async (req, res, next) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment || !(await shipmentInScope(req, shipment))) return next(new AppError("Shipment not found", 404));
  assertShipmentUnlocked(shipment, "claim it");
  if (shipment.opsOwnerId === req.user.id) {
    return res.json({ success: true, message: "You already own this shipment", data: { opsOwnerId: req.user.id } });
  }
  if (shipment.opsOwnerId) {
    const owner = await prisma.user.findUnique({
      where: { id: shipment.opsOwnerId },
      select: { email: true, employee: { select: { firstName: true, lastName: true } } },
    });
    const who = owner?.employee
      ? `${owner.employee.firstName} ${owner.employee.lastName}`
      : owner?.email ?? "another ops user";
    return next(new AppError(`Already claimed by ${who}`, 409));
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipment.id },
      data: { opsOwnerId: req.user.id, opsClaimedAt: new Date() },
    });
    await auditShipment(tx, {
      actorId: req.user.id,
      action: "shipment.claim",
      resourceType: "shipment",
      resourceId: shipment.id,
      diff: { opsOwnerId: req.user.id },
    });
    await emitShipmentEvent(tx, "shipment.claimed", {
      shipmentId: shipment.id,
      shipmentRef: shipment.referenceNo,
      ownerId: req.user.id,
    });
  });

  res.json({
    success: true,
    message: `You own ${shipment.referenceNo} — its steps are yours to work`,
    data: { opsOwnerId: req.user.id },
  });
});

/* ── POST /api/shipments/:id/assign ── (Management reassigns or releases) */
/**
 * Hand a shipment to a different ops person, or release it back to the pool with
 * `ownerId: null` — the escape hatch for an owner who is on leave. Management only
 * (`shipment.assign`), so one ops user can never take a job off a colleague.
 */
export const assignShipment = catchAsync(async (req, res, next) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment || !(await shipmentInScope(req, shipment))) return next(new AppError("Shipment not found", 404));
  assertShipmentUnlocked(shipment, "change who owns it");

  const { ownerId } = req.body;
  if (ownerId) {
    const target = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, isActive: true, role: true, roles: true },
    });
    if (!target || !target.isActive) return next(new AppError("That user was not found", 404));
    const held = target.roles?.length ? target.roles : [target.role];
    if (!held.some((r) => ["ops_manager", "ops_exec"].includes(r))) {
      return next(new AppError("A shipment can only be owned by an Operations user", 422));
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipment.id },
      data: { opsOwnerId: ownerId ?? null, opsClaimedAt: ownerId ? new Date() : null },
    });
    await auditShipment(tx, {
      actorId: req.user.id,
      action: ownerId ? "shipment.assign" : "shipment.release",
      resourceType: "shipment",
      resourceId: shipment.id,
      diff: { from: shipment.opsOwnerId, to: ownerId ?? null },
    });
    // Spelled out rather than computed so the event catalog stays statically
    // greppable (scripts/verifyEventTopics.js scans for the literals).
    const payload = {
      shipmentId: shipment.id,
      shipmentRef: shipment.referenceNo,
      ownerId: ownerId ?? null,
      reassignedBy: req.user.id,
    };
    if (ownerId) await emitShipmentEvent(tx, "shipment.claimed", payload);
    else await emitShipmentEvent(tx, "shipment.released", payload);
  });

  res.json({
    success: true,
    message: ownerId ? "Shipment reassigned" : "Shipment released back to the pool",
    data: { opsOwnerId: ownerId ?? null },
  });
});
