import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { renderPackingListPdf, renderCommercialInvoicePdf } from "../../utils/tradePdf.js";
import { buildDocumentFileName } from "../document/document.service.js";
import {
  allocateTradeRef,
  assertTradeWritable,
  audit,
  dec,
  emitEvent,
  loadTradeShipment,
  recalcFiDrawn,
  recalcPackingListTotals,
  recalcTradeInvoiceTotal,
  recomputeTradeStage,
  round2,
  tradeAlertsFor,
} from "./trade.service.js";

/**
 * Export trade documents (Export Shipment Workflow roadmap §4).
 *
 * Two registers live outside a shipment because the roadmap cycle starts before one
 * exists (Step 1): Trade Contracts and Financial Instruments. Everything else hangs off
 * a shipment and inherits its row-level scope.
 *
 * Permissions are per document family, so the department that owns a step also owns that
 * step's paperwork: Operations the cargo documents and the B/L, Compliance the Goods
 * Declaration, Finance the instrument and the sale invoice.
 */

const ok = (res, message, data, status = 200) => res.status(status).json({ success: true, message, data });

/** Refresh the derived stage after any document write, in the same transaction. */
const restage = (tx, shipmentId, actorId) => recomputeTradeStage(tx, shipmentId, actorId);

const FI_INCLUDE = {
  vendor: { select: { id: true, name: true, referenceNo: true, taxId: true, rexNo: true, iban: true } },
  bank: { select: { id: true, name: true, referenceNo: true, bankName: true, bankBranch: true, swiftCode: true } },
  buyer: { select: { id: true, name: true, referenceNo: true, country: true, vatNo: true } },
  contract: { select: { id: true, referenceNo: true, contractNo: true } },
};

// ══ §4.1 Trade contracts ═════════════════════════════════════════════════════

export const listContracts = catchAsync(async (req, res) => {
  const { vendorId, customerId, status, q } = req.query;
  const rows = await prisma.tradeContract.findMany({
    where: {
      ...(vendorId ? { vendorId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(status ? { status } : {}),
      ...(q
        ? { OR: [{ contractNo: { contains: q, mode: "insensitive" } }, { referenceNo: { contains: q, mode: "insensitive" } }] }
        : {}),
    },
    include: {
      vendor: { select: { id: true, name: true, referenceNo: true, type: true } },
      _count: { select: { financialInstruments: true, shipments: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  ok(res, undefined, rows);
});

export const getContract = catchAsync(async (req, res, next) => {
  const row = await prisma.tradeContract.findUnique({
    where: { id: req.params.id },
    include: {
      vendor: true,
      financialInstruments: {
        select: { id: true, referenceNo: true, fiNumber: true, value: true, currency: true, status: true, expiryDate: true },
      },
      shipments: { select: { id: true, referenceNo: true, status: true, tradeStage: true } },
    },
  });
  if (!row) return next(new AppError("Contract not found", 404));
  ok(res, undefined, row);
});

export const createContract = catchAsync(async (req, res, next) => {
  const vendor = await prisma.vendor.findUnique({
    where: { id: req.body.vendorId },
    select: { id: true, isActive: true, name: true },
  });
  if (!vendor) return next(new AppError("Vendor not found", 404));
  if (!vendor.isActive) return next(new AppError(`${vendor.name} is deactivated`, 409));

  const row = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateTradeRef(tx, "trade_contract");
    const created = await tx.tradeContract.create({ data: { ...req.body, referenceNo, createdById: req.user.id } });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.contract.created",
      resourceType: "trade_contract",
      resourceId: created.id,
      diff: { contractNo: created.contractNo, vendorId: created.vendorId },
    });
    await emitEvent(tx, "trade.contract.created", { contractId: created.id, referenceNo });
    return created;
  });
  ok(res, "Contract registered", row, 201);
});

export const updateContract = catchAsync(async (req, res, next) => {
  const existing = await prisma.tradeContract.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Contract not found", 404));

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.tradeContract.update({ where: { id: existing.id }, data: req.body });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.contract.updated",
      resourceType: "trade_contract",
      resourceId: updated.id,
      diff: { before: existing, after: updated },
    });
    return updated;
  });
  ok(res, "Contract updated", row);
});

// ══ §4.2 Financial instruments ═══════════════════════════════════════════════

export const listFis = catchAsync(async (req, res) => {
  const { status, vendorId, expiringDays, q } = req.query;
  const where = {
    ...(status ? { status } : {}),
    ...(vendorId ? { vendorId } : {}),
    ...(q
      ? { OR: [{ fiNumber: { contains: q, mode: "insensitive" } }, { referenceNo: { contains: q, mode: "insensitive" } }] }
      : {}),
  };
  // The expiry board on the instruments page (roadmap §7.2, first flag).
  if (expiringDays) {
    where.status = "active";
    where.expiryDate = { lte: new Date(Date.now() + Number(expiringDays) * 24 * 60 * 60 * 1000) };
  }
  const rows = await prisma.financialInstrument.findMany({
    where,
    include: { ...FI_INCLUDE, _count: { select: { shipments: true, drawdowns: true } } },
    orderBy: { expiryDate: "asc" },
    take: 200,
  });
  ok(res, undefined, rows);
});

export const getFi = catchAsync(async (req, res, next) => {
  const row = await prisma.financialInstrument.findUnique({
    where: { id: req.params.id },
    include: {
      ...FI_INCLUDE,
      drawdowns: { orderBy: { realisedAt: "desc" } },
      shipments: { select: { id: true, referenceNo: true, status: true, tradeStage: true } },
      tradeInvoices: { select: { id: true, invoiceNo: true, side: true, totalValue: true, currency: true, status: true } },
    },
  });
  if (!row) return next(new AppError("Financial instrument not found", 404));
  ok(res, undefined, row);
});

export const createFi = catchAsync(async (req, res, next) => {
  const [vendor, bank] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: req.body.vendorId }, select: { id: true } }),
    prisma.vendor.findUnique({ where: { id: req.body.bankVendorId }, select: { id: true } }),
  ]);
  if (!vendor) return next(new AppError("Vendor not found", 404));
  if (!bank) return next(new AppError("Bank not found", 404));

  const clash = await prisma.financialInstrument.findUnique({ where: { fiNumber: req.body.fiNumber } });
  if (clash) return next(new AppError(`Instrument ${req.body.fiNumber} is already registered`, 409));

  const row = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateTradeRef(tx, "financial_instrument");
    const created = await tx.financialInstrument.create({ data: { ...req.body, referenceNo, createdById: req.user.id } });
    await audit(tx, {
      actorId: req.user.id,
      action: "fi.registered",
      resourceType: "financial_instrument",
      resourceId: created.id,
      diff: { fiNumber: created.fiNumber, value: created.value, currency: created.currency, expiryDate: created.expiryDate },
    });
    await emitEvent(tx, "fi.registered", { financialInstrumentId: created.id, referenceNo });
    return created;
  });
  ok(res, "Financial instrument registered", row, 201);
});

export const updateFi = catchAsync(async (req, res, next) => {
  const existing = await prisma.financialInstrument.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Financial instrument not found", 404));
  if (existing.status === "closed") return next(new AppError("This instrument is closed and can no longer be edited", 409));
  if (req.body.value != null && Number(req.body.value) < dec(existing.drawnAmount)) {
    return next(new AppError(`The value cannot drop below what has already been drawn (${existing.drawnAmount})`, 409));
  }

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.financialInstrument.update({ where: { id: existing.id }, data: req.body });
    await audit(tx, {
      actorId: req.user.id,
      action: "fi.updated",
      resourceType: "financial_instrument",
      resourceId: updated.id,
      diff: { before: existing, after: updated },
    });
    for (const s of await tx.shipment.findMany({ where: { financialInstrumentId: updated.id }, select: { id: true } })) {
      await restage(tx, s.id, req.user.id);
    }
    return updated;
  });
  ok(res, "Financial instrument updated", row);
});

/** Roadmap Step 7 — proceeds realised against the instrument. */
export const addDrawdown = catchAsync(async (req, res, next) => {
  const fi = await prisma.financialInstrument.findUnique({ where: { id: req.params.id } });
  if (!fi) return next(new AppError("Financial instrument not found", 404));
  if (fi.status === "closed") return next(new AppError("This instrument is closed", 409));

  const total = dec(fi.drawnAmount) + Number(req.body.amount);
  if (total > dec(fi.value) + 0.005) {
    return next(new AppError(`That would draw ${round2(total)} against an instrument worth ${fi.value} ${fi.currency}`, 409));
  }

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.financialInstrumentDrawdown.create({
      data: { ...req.body, financialInstrumentId: fi.id, recordedById: req.user.id },
    });
    await recalcFiDrawn(tx, fi.id);
    await audit(tx, {
      actorId: req.user.id,
      action: "fi.drawdown.recorded",
      resourceType: "financial_instrument",
      resourceId: fi.id,
      diff: { amount: created.amount, realisedAt: created.realisedAt },
    });
    await emitEvent(tx, "fi.drawdown.recorded", { financialInstrumentId: fi.id, amount: created.amount });
    if (created.shipmentId) {
      await restage(tx, created.shipmentId, req.user.id);
    } else {
      for (const s of await tx.shipment.findMany({ where: { financialInstrumentId: fi.id }, select: { id: true } })) {
        await restage(tx, s.id, req.user.id);
      }
    }
    return created;
  });
  ok(res, "Drawdown recorded", row, 201);
});

/** Roadmap Step 8 — closure. */
export const closeFi = catchAsync(async (req, res, next) => {
  const fi = await prisma.financialInstrument.findUnique({ where: { id: req.params.id } });
  if (!fi) return next(new AppError("Financial instrument not found", 404));
  if (fi.status === "closed") return next(new AppError("This instrument is already closed", 409));

  const outstanding = round2(dec(fi.value) - dec(fi.drawnAmount));
  if (outstanding > 0.005 && !req.body.force) {
    return next(
      new AppError(`${outstanding} ${fi.currency} has not been realised yet. Close it anyway by confirming, and say why.`, 409),
    );
  }
  if (outstanding > 0.005 && !req.body.reason) {
    return next(new AppError("Closing an instrument that is not fully drawn needs a reason", 400));
  }

  const row = await prisma.$transaction(async (tx) => {
    const closed = await tx.financialInstrument.update({
      where: { id: fi.id },
      data: { status: "closed", closedById: req.user.id, closedAt: new Date() },
    });
    await audit(tx, {
      actorId: req.user.id,
      action: "fi.closed",
      resourceType: "financial_instrument",
      resourceId: fi.id,
      diff: { outstanding, reason: req.body.reason ?? null },
    });
    await emitEvent(tx, "fi.closed", { financialInstrumentId: fi.id });
    for (const s of await tx.shipment.findMany({ where: { financialInstrumentId: fi.id }, select: { id: true } })) {
      await restage(tx, s.id, req.user.id);
    }
    return closed;
  });
  ok(res, "Financial instrument closed", row);
});

// ══ §7 Containers ════════════════════════════════════════════════════════════

export const listContainers = catchAsync(async (req, res) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  const rows = await prisma.shipmentContainer.findMany({
    where: { shipmentId: shipment.id },
    orderBy: { containerNo: "asc" },
  });
  ok(res, undefined, rows);
});

export const addContainer = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "add containers");
  const clash = await prisma.shipmentContainer.findFirst({
    where: { shipmentId: shipment.id, containerNo: req.body.containerNo },
  });
  if (clash) return next(new AppError(`Container ${req.body.containerNo} is already on this shipment`, 409));

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.shipmentContainer.create({ data: { ...req.body, shipmentId: shipment.id } });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.container.added",
      resourceType: "shipment_container",
      resourceId: created.id,
      diff: { shipmentId: shipment.id, containerNo: created.containerNo, sealNo: created.sealNo },
    });
    await emitEvent(tx, "trade.container.changed", { shipmentId: shipment.id, containerId: created.id });
    return created;
  });
  ok(res, "Container added", row, 201);
});

export const updateContainer = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "change containers");
  const existing = await prisma.shipmentContainer.findFirst({
    where: { id: req.params.containerId, shipmentId: shipment.id },
  });
  if (!existing) return next(new AppError("Container not found on this shipment", 404));

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.shipmentContainer.update({ where: { id: existing.id }, data: req.body });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.container.updated",
      resourceType: "shipment_container",
      resourceId: updated.id,
      diff: { before: existing, after: updated },
    });
    await emitEvent(tx, "trade.container.changed", { shipmentId: shipment.id, containerId: updated.id });
    return updated;
  });
  ok(res, "Container updated", row);
});

export const removeContainer = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "remove containers");
  const existing = await prisma.shipmentContainer.findFirst({
    where: { id: req.params.containerId, shipmentId: shipment.id },
  });
  if (!existing) return next(new AppError("Container not found on this shipment", 404));

  const [onBol, onPl] = await Promise.all([
    prisma.billOfLadingContainer.count({ where: { containerId: existing.id } }),
    prisma.packingList.count({ where: { containerId: existing.id } }),
  ]);
  if (onBol || onPl) {
    return next(new AppError("This container is referenced by the Bill of Lading or the packing list — detach it there first", 409));
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipmentContainer.delete({ where: { id: existing.id } });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.container.removed",
      resourceType: "shipment_container",
      resourceId: existing.id,
      diff: { shipmentId: shipment.id, containerNo: existing.containerNo },
    });
    await emitEvent(tx, "trade.container.changed", { shipmentId: shipment.id, containerId: existing.id });
  });
  ok(res, "Container removed");
});

// ══ §4.3 Packing list ════════════════════════════════════════════════════════

export const getPackingList = catchAsync(async (req, res) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  const row = await prisma.packingList.findUnique({
    where: { shipmentId: shipment.id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      container: true,
      issuedByVendor: { select: { id: true, name: true, referenceNo: true } },
    },
  });
  ok(res, undefined, row);
});

export const upsertPackingList = catchAsync(async (req, res) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "change the packing list");

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.packingList.findUnique({ where: { shipmentId: shipment.id } });
    let saved;
    if (existing) {
      saved = await tx.packingList.update({ where: { id: existing.id }, data: req.body });
    } else {
      const referenceNo = await allocateTradeRef(tx, "packing_list");
      saved = await tx.packingList.create({
        data: { ...req.body, shipmentId: shipment.id, referenceNo, createdById: req.user.id },
      });
    }
    await audit(tx, {
      actorId: req.user.id,
      action: existing ? "trade.packing_list.updated" : "trade.packing_list.created",
      resourceType: "packing_list",
      resourceId: saved.id,
      diff: { shipmentId: shipment.id },
    });
    await emitEvent(tx, "packing_list.changed", { shipmentId: shipment.id, packingListId: saved.id });
    return saved;
  });
  ok(res, "Packing list saved", row);
});

/** The whole item collection is replaced, then the header totals are recomputed. */
export const replacePackingListItems = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "change the packing list");
  const pl = await prisma.packingList.findUnique({ where: { shipmentId: shipment.id } });
  if (!pl) return next(new AppError("Create the packing list before adding items", 404));

  const row = await prisma.$transaction(async (tx) => {
    await tx.packingListItem.deleteMany({ where: { packingListId: pl.id } });
    if (req.body.items.length) {
      await tx.packingListItem.createMany({
        data: req.body.items.map((i, idx) => ({ ...i, packingListId: pl.id, sortOrder: idx * 10 })),
      });
    }
    const updated = await recalcPackingListTotals(tx, pl.id);
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.packing_list.items_replaced",
      resourceType: "packing_list",
      resourceId: pl.id,
      diff: {
        count: req.body.items.length,
        totals: { cartons: updated.totalCartons, pieces: updated.totalPieces, gross: updated.totalGrossWeightKg },
      },
    });
    await emitEvent(tx, "packing_list.changed", { shipmentId: shipment.id, packingListId: pl.id });
    return updated;
  });
  const items = await prisma.packingListItem.findMany({ where: { packingListId: pl.id }, orderBy: { sortOrder: "asc" } });
  ok(res, "Packing list items saved", { ...row, items });
});

/** Confirming is what advances the roadmap stage (§7.1, "Packing List Confirmed"). */
export const confirmPackingList = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "confirm the packing list");
  const pl = await prisma.packingList.findUnique({ where: { shipmentId: shipment.id }, include: { items: true } });
  if (!pl) return next(new AppError("There is no packing list to confirm", 404));
  if (!pl.items.length) return next(new AppError("A packing list with no items cannot be confirmed", 422));

  const row = await prisma.$transaction(async (tx) => {
    const confirmed = await tx.packingList.update({
      where: { id: pl.id },
      data: { confirmedById: req.user.id, confirmedAt: new Date() },
    });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.packing_list.confirmed",
      resourceType: "packing_list",
      resourceId: pl.id,
      diff: { shipmentId: shipment.id },
    });
    await emitEvent(tx, "packing_list.confirmed", { shipmentId: shipment.id, packingListId: pl.id });
    await restage(tx, shipment.id, req.user.id);
    return confirmed;
  });
  ok(res, "Packing list confirmed", row);
});

// ══ §4.4 Commercial invoice ══════════════════════════════════════════════════

/**
 * `side` decides who may write the row, not just which permission guards the route:
 * a purchase invoice is a cost Operations records, a sale invoice is revenue Accounts
 * raises and issues. Enforced here so the rule holds however the endpoint is reached.
 */
const assertMayWriteSide = (req, side) => {
  if (side === "sale" && !req.user.permissions?.includes("trade.invoice.issue")) {
    throw new AppError("A sale invoice is raised by Accounts — record the vendor purchase invoice instead.", 403);
  }
};

export const listTradeInvoices = catchAsync(async (req, res) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  const where = { shipmentId: shipment.id };
  // Portal containment: a customer never sees what Consort paid the vendor.
  if (req.user.role === "customer") where.side = "sale";
  const rows = await prisma.tradeInvoice.findMany({
    where,
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      financialInstrument: { select: { id: true, fiNumber: true, value: true, currency: true } },
    },
    orderBy: { invoiceDate: "desc" },
  });
  ok(res, undefined, rows);
});

export const createTradeInvoice = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "raise invoices");
  assertMayWriteSide(req, req.body.side);

  const clash = await prisma.tradeInvoice.findFirst({
    where: { shipmentId: shipment.id, side: req.body.side, invoiceNo: req.body.invoiceNo },
  });
  if (clash) return next(new AppError(`Invoice ${req.body.invoiceNo} already exists on this shipment`, 409));

  const row = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateTradeRef(tx, "trade_invoice");
    const created = await tx.tradeInvoice.create({
      data: { ...req.body, shipmentId: shipment.id, referenceNo, createdById: req.user.id },
    });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.invoice.created",
      resourceType: "trade_invoice",
      resourceId: created.id,
      diff: { shipmentId: shipment.id, side: created.side, invoiceNo: created.invoiceNo },
    });
    await emitEvent(tx, "trade_invoice.changed", { shipmentId: shipment.id, tradeInvoiceId: created.id });
    return created;
  });
  ok(res, "Commercial invoice created", row, 201);
});

export const updateTradeInvoice = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "change invoices");
  const existing = await prisma.tradeInvoice.findFirst({ where: { id: req.params.invoiceId, shipmentId: shipment.id } });
  if (!existing) return next(new AppError("Invoice not found on this shipment", 404));
  assertMayWriteSide(req, existing.side);
  if (existing.status !== "draft") {
    return next(new AppError("An issued invoice can no longer be edited — void it and raise a new one", 409));
  }

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.tradeInvoice.update({ where: { id: existing.id }, data: req.body });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.invoice.updated",
      resourceType: "trade_invoice",
      resourceId: updated.id,
      diff: { before: existing, after: updated },
    });
    await emitEvent(tx, "trade_invoice.changed", { shipmentId: shipment.id, tradeInvoiceId: updated.id });
    return updated;
  });
  ok(res, "Invoice updated", row);
});

export const replaceTradeInvoiceLines = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "change invoices");
  const inv = await prisma.tradeInvoice.findFirst({ where: { id: req.params.invoiceId, shipmentId: shipment.id } });
  if (!inv) return next(new AppError("Invoice not found on this shipment", 404));
  assertMayWriteSide(req, inv.side);
  if (inv.status !== "draft") return next(new AppError("An issued invoice can no longer be edited", 409));

  const row = await prisma.$transaction(async (tx) => {
    await tx.tradeInvoiceLine.deleteMany({ where: { tradeInvoiceId: inv.id } });
    if (req.body.lines.length) {
      await tx.tradeInvoiceLine.createMany({
        data: req.body.lines.map((l, idx) => ({
          ...l,
          tradeInvoiceId: inv.id,
          // The server computes every amount — a client total is ignored, as on quotations.
          amount: round2(Number(l.quantity) * Number(l.unitPrice)),
          sortOrder: idx * 10,
        })),
      });
    }
    const updated = await recalcTradeInvoiceTotal(tx, inv.id);
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.invoice.lines_replaced",
      resourceType: "trade_invoice",
      resourceId: inv.id,
      diff: { count: req.body.lines.length, totalValue: updated.totalValue },
    });
    await emitEvent(tx, "trade_invoice.changed", { shipmentId: shipment.id, tradeInvoiceId: inv.id });
    return updated;
  });
  const lines = await prisma.tradeInvoiceLine.findMany({ where: { tradeInvoiceId: inv.id }, orderBy: { sortOrder: "asc" } });
  ok(res, "Invoice lines saved", { ...row, lines });
});

/**
 * Roadmap §6/§8 — the packing list is the authoritative source for the cargo, so the
 * invoice lines are seeded from it rather than retyped. Unit prices stay blank for the
 * desk to fill: the packing list knows what shipped, not what it sells for.
 */
export const seedLinesFromPackingList = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "change invoices");
  const [inv, pl] = await Promise.all([
    prisma.tradeInvoice.findFirst({ where: { id: req.params.invoiceId, shipmentId: shipment.id } }),
    prisma.packingList.findUnique({ where: { shipmentId: shipment.id }, include: { items: { orderBy: { sortOrder: "asc" } } } }),
  ]);
  if (!inv) return next(new AppError("Invoice not found on this shipment", 404));
  assertMayWriteSide(req, inv.side);
  if (inv.status !== "draft") return next(new AppError("An issued invoice can no longer be edited", 409));
  if (!pl?.items.length) return next(new AppError("There is no packing list to seed from", 404));

  const row = await prisma.$transaction(async (tx) => {
    await tx.tradeInvoiceLine.deleteMany({ where: { tradeInvoiceId: inv.id } });
    await tx.tradeInvoiceLine.createMany({
      data: pl.items.map((i, idx) => ({
        tradeInvoiceId: inv.id,
        packingListItemId: i.id,
        description: i.description,
        hsCode: i.hsCode,
        quantity: i.pieces ?? 1,
        unitOfMeasure: "PCS",
        unitPrice: 0,
        amount: 0,
        sortOrder: idx * 10,
      })),
    });
    const updated = await recalcTradeInvoiceTotal(tx, inv.id);
    await tx.tradeInvoice.update({ where: { id: inv.id }, data: { packingListId: pl.id } });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.invoice.seeded_from_packing_list",
      resourceType: "trade_invoice",
      resourceId: inv.id,
      diff: { packingListId: pl.id, count: pl.items.length },
    });
    await emitEvent(tx, "trade_invoice.changed", { shipmentId: shipment.id, tradeInvoiceId: inv.id });
    return updated;
  });
  const lines = await prisma.tradeInvoiceLine.findMany({ where: { tradeInvoiceId: inv.id }, orderBy: { sortOrder: "asc" } });
  ok(res, `${lines.length} line(s) seeded from the packing list — set the unit prices`, { ...row, lines });
});

/**
 * Issuing is the four-eyes step (`trade.invoice.issue`, Accounts). A SALE invoice also
 * drafts the receivable the OTC ledger and maybeSettleTx already run on, so a trade
 * shipment settles through exactly the same path as a forwarding one.
 */
export const issueTradeInvoice = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "issue invoices");
  const inv = await prisma.tradeInvoice.findFirst({
    where: { id: req.params.invoiceId, shipmentId: shipment.id },
    include: { lines: true },
  });
  if (!inv) return next(new AppError("Invoice not found on this shipment", 404));
  if (inv.status !== "draft") return next(new AppError(`This invoice is already ${inv.status}`, 409));
  if (!inv.lines.length) return next(new AppError("An invoice with no lines cannot be issued", 422));

  const row = await prisma.$transaction(async (tx) => {
    let receivableInvoiceId = null;
    if (inv.side === "sale") {
      const referenceNo = await allocateRef(tx, "invoice");
      const ar = await tx.invoice.create({
        data: {
          referenceNo,
          shipmentId: shipment.id,
          kind: "receivable",
          currency: inv.currency,
          totalAmount: inv.totalValue,
          status: "draft",
          financialInstrumentId: inv.financialInstrumentId,
          lines: {
            create: inv.lines.map((l, idx) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              amount: l.amount,
              sortOrder: idx * 10,
            })),
          },
        },
      });
      receivableInvoiceId = ar.id;
    }
    const issued = await tx.tradeInvoice.update({
      where: { id: inv.id },
      data: { status: "issued", issuedById: req.user.id, issuedAt: new Date(), receivableInvoiceId },
    });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.invoice.issued",
      resourceType: "trade_invoice",
      resourceId: inv.id,
      diff: { side: inv.side, totalValue: inv.totalValue, receivableInvoiceId },
    });
    await emitEvent(tx, "trade_invoice.issued", { shipmentId: shipment.id, tradeInvoiceId: inv.id, side: inv.side });
    await restage(tx, shipment.id, req.user.id);
    return issued;
  });
  ok(res, inv.side === "sale" ? "Invoice issued — a receivable has been drafted for Accounts" : "Invoice issued", row);
});

export const voidTradeInvoice = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  const inv = await prisma.tradeInvoice.findFirst({ where: { id: req.params.invoiceId, shipmentId: shipment.id } });
  if (!inv) return next(new AppError("Invoice not found on this shipment", 404));
  if (inv.status === "void") return next(new AppError("This invoice is already void", 409));

  const row = await prisma.$transaction(async (tx) => {
    const voided = await tx.tradeInvoice.update({
      where: { id: inv.id },
      data: { status: "void", voidedById: req.user.id, voidedAt: new Date(), voidReason: req.body.reason },
    });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.invoice.voided",
      resourceType: "trade_invoice",
      resourceId: inv.id,
      diff: { reason: req.body.reason },
    });
    await emitEvent(tx, "trade_invoice.changed", { shipmentId: shipment.id, tradeInvoiceId: inv.id });
    await restage(tx, shipment.id, req.user.id);
    return voided;
  });
  ok(res, "Invoice voided", row);
});

// ══ §4.5 Bill of lading ══════════════════════════════════════════════════════

export const getBol = catchAsync(async (req, res) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  const row = await prisma.billOfLading.findUnique({
    where: { shipmentId: shipment.id },
    include: {
      carrier: { select: { id: true, name: true, referenceNo: true } },
      carrierAgent: { select: { id: true, name: true, referenceNo: true } },
      containers: { include: { container: true } },
    },
  });
  ok(res, undefined, row);
});

export const upsertBol = catchAsync(async (req, res) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "change the Bill of Lading");
  const { containerIds, ...data } = req.body;

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.billOfLading.findUnique({ where: { shipmentId: shipment.id } });
    let saved;
    if (existing) {
      saved = await tx.billOfLading.update({ where: { id: existing.id }, data });
    } else {
      const referenceNo = await allocateTradeRef(tx, "bill_of_lading");
      saved = await tx.billOfLading.create({
        data: { ...data, shipmentId: shipment.id, referenceNo, createdById: req.user.id },
      });
    }
    if (containerIds) {
      await tx.billOfLadingContainer.deleteMany({ where: { billOfLadingId: saved.id } });
      if (containerIds.length) {
        // Only containers that belong to THIS shipment — a stray id is ignored, not an error.
        const owned = await tx.shipmentContainer.findMany({
          where: { id: { in: containerIds }, shipmentId: shipment.id },
          select: { id: true },
        });
        await tx.billOfLadingContainer.createMany({
          data: owned.map((c) => ({ billOfLadingId: saved.id, containerId: c.id })),
        });
      }
    }
    await audit(tx, {
      actorId: req.user.id,
      action: existing ? "trade.bol.updated" : "trade.bol.created",
      resourceType: "bill_of_lading",
      resourceId: saved.id,
      diff: { shipmentId: shipment.id, blNumber: saved.blNumber, shippedOnBoard: saved.shippedOnBoard },
    });
    await emitEvent(tx, "bol.changed", { shipmentId: shipment.id, billOfLadingId: saved.id });
    await restage(tx, shipment.id, req.user.id);
    return saved;
  });
  ok(res, "Bill of Lading saved", row);
});

// ══ §4.6 Goods declaration ═══════════════════════════════════════════════════

export const getGd = catchAsync(async (req, res) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  const row = await prisma.goodsDeclaration.findUnique({
    where: { shipmentId: shipment.id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      clearingAgent: { select: { id: true, name: true, referenceNo: true, taxId: true, strn: true } },
      financialInstrument: { select: { id: true, fiNumber: true } },
      tradeInvoice: { select: { id: true, invoiceNo: true, currency: true, totalValue: true } },
    },
  });
  // The customer has no business seeing assessed customs values or duty.
  if (row && req.user.role === "customer") {
    return ok(res, undefined, {
      id: row.id,
      gdNumber: row.gdNumber,
      gdDate: row.gdDate,
      filedAt: row.filedAt,
      outOfChargeAt: row.outOfChargeAt,
    });
  }
  ok(res, undefined, row);
});

export const upsertGd = catchAsync(async (req, res) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "change the Goods Declaration");

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.goodsDeclaration.findUnique({ where: { shipmentId: shipment.id } });
    let saved;
    if (existing) {
      saved = await tx.goodsDeclaration.update({ where: { id: existing.id }, data: req.body });
    } else {
      const referenceNo = await allocateTradeRef(tx, "goods_declaration");
      saved = await tx.goodsDeclaration.create({
        data: { ...req.body, shipmentId: shipment.id, referenceNo, createdById: req.user.id },
      });
    }
    await audit(tx, {
      actorId: req.user.id,
      action: existing ? "trade.gd.updated" : "trade.gd.created",
      resourceType: "goods_declaration",
      resourceId: saved.id,
      diff: { shipmentId: shipment.id, gdNumber: saved.gdNumber, filedAt: saved.filedAt },
    });
    await emitEvent(tx, "gd.changed", { shipmentId: shipment.id, goodsDeclarationId: saved.id });
    await restage(tx, shipment.id, req.user.id);
    return saved;
  });
  ok(res, "Goods Declaration saved", row);
});

export const replaceGdLines = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "change the Goods Declaration");
  const gd = await prisma.goodsDeclaration.findUnique({ where: { shipmentId: shipment.id } });
  if (!gd) return next(new AppError("Create the Goods Declaration before adding lines", 404));

  await prisma.$transaction(async (tx) => {
    await tx.goodsDeclarationLine.deleteMany({ where: { goodsDeclarationId: gd.id } });
    if (req.body.lines.length) {
      await tx.goodsDeclarationLine.createMany({
        data: req.body.lines.map((l, idx) => ({ ...l, goodsDeclarationId: gd.id, sortOrder: idx * 10 })),
      });
    }
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.gd.lines_replaced",
      resourceType: "goods_declaration",
      resourceId: gd.id,
      diff: { count: req.body.lines.length },
    });
    await emitEvent(tx, "gd.changed", { shipmentId: shipment.id, goodsDeclarationId: gd.id });
  });
  const lines = await prisma.goodsDeclarationLine.findMany({
    where: { goodsDeclarationId: gd.id },
    orderBy: { sortOrder: "asc" },
  });
  ok(res, "Declaration lines saved", { ...gd, lines });
});

// ══ Aggregate read + alerts ══════════════════════════════════════════════════

/** Everything the Trade Documents panel needs, in one round trip. */
export const getTradeOverview = catchAsync(async (req, res) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  const isCustomer = req.user.role === "customer";

  const [contract, fi, containers, packingList, invoices, bol, gd, stageHistory, alerts] = await Promise.all([
    shipment.contractId
      ? prisma.tradeContract.findUnique({ where: { id: shipment.contractId }, include: { vendor: { select: { id: true, name: true } } } })
      : null,
    shipment.financialInstrumentId
      ? prisma.financialInstrument.findUnique({ where: { id: shipment.financialInstrumentId }, include: FI_INCLUDE })
      : null,
    prisma.shipmentContainer.findMany({ where: { shipmentId: shipment.id }, orderBy: { containerNo: "asc" } }),
    prisma.packingList.findUnique({ where: { shipmentId: shipment.id }, include: { items: { orderBy: { sortOrder: "asc" } } } }),
    prisma.tradeInvoice.findMany({
      where: { shipmentId: shipment.id, ...(isCustomer ? { side: "sale" } : {}) },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
      orderBy: { invoiceDate: "desc" },
    }),
    prisma.billOfLading.findUnique({ where: { shipmentId: shipment.id }, include: { containers: { include: { container: true } } } }),
    prisma.goodsDeclaration.findUnique({ where: { shipmentId: shipment.id }, include: { lines: { orderBy: { sortOrder: "asc" } } } }),
    prisma.shipmentTradeStageHistory.findMany({ where: { shipmentId: shipment.id }, orderBy: { createdAt: "asc" } }),
    tradeAlertsFor(shipment.id),
  ]);

  ok(res, undefined, {
    shipmentId: shipment.id,
    kind: shipment.kind,
    direction: shipment.direction,
    tradeStage: shipment.tradeStage,
    // The instrument is the vendor's bank paperwork — never the customer's to see.
    contract: isCustomer ? null : contract,
    financialInstrument: isCustomer ? null : fi,
    containers,
    packingList,
    tradeInvoices: invoices,
    billOfLading: bol,
    goodsDeclaration:
      isCustomer && gd
        ? { id: gd.id, gdNumber: gd.gdNumber, gdDate: gd.gdDate, filedAt: gd.filedAt, outOfChargeAt: gd.outOfChargeAt }
        : gd,
    stageHistory,
    alerts: isCustomer ? [] : alerts,
  });
});

export const getTradeAlerts = catchAsync(async (req, res) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  ok(res, undefined, await tradeAlertsFor(shipment.id));
});

// ══ Document generation (roadmap §8) ═════════════════════════════════════════

/**
 * Attach a generated file as a real shipment Document, so it satisfies the matching
 * `order_confirmed` checklist item exactly the way an uploaded scan would (ADR-048).
 * Best-effort by the same contract as the quotation PDF: a rendering failure returns a
 * clear error rather than corrupting the record it was generated from.
 */
const attachGenerated = async (tx, { file, shipment, docType, actorId, previousDocumentId }) => {
  const fileName = await buildDocumentFileName({
    ownerType: "shipment",
    ownerId: shipment.id,
    docType,
    originalName: file.fileName,
    mimeType: file.mimeType,
    shipmentRef: shipment.referenceNo,
    db: tx,
  });
  // Regenerating replaces the previous generated copy rather than piling up near
  // duplicates on the checklist. An uploaded scan of the same type is untouched.
  if (previousDocumentId) {
    await tx.document.updateMany({
      where: { id: previousDocumentId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
  const doc = await tx.document.create({
    data: {
      ownerType: "shipment",
      ownerId: shipment.id,
      ...file,
      fileName,
      docType,
      scanStatus: "clean", // generated by us — never touched an upload path
      uploadedById: actorId,
    },
  });
  await emitEvent(tx, "shipment.documents.changed", { shipmentId: shipment.id, ownerType: "shipment", ownerId: shipment.id });
  return doc;
};

export const generatePackingListPdf = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "generate the packing list");
  const pl = await prisma.packingList.findUnique({
    where: { shipmentId: shipment.id },
    include: { items: { orderBy: { sortOrder: "asc" } }, container: true, issuedByVendor: true },
  });
  if (!pl) return next(new AppError("There is no packing list to render", 404));
  if (!pl.items.length) return next(new AppError("A packing list with no items cannot be rendered", 422));

  const file = await renderPackingListPdf({ packingList: pl, shipment, vendor: pl.issuedByVendor, container: pl.container });
  if (!file) return next(new AppError("PDF generation is unavailable — run `npm i pdfkit` in erp-backend", 503));

  const doc = await prisma.$transaction(async (tx) => {
    const created = await attachGenerated(tx, {
      file,
      shipment,
      docType: "packing_list",
      actorId: req.user.id,
      previousDocumentId: pl.documentId,
    });
    await tx.packingList.update({ where: { id: pl.id }, data: { documentId: created.id } });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.packing_list.generated",
      resourceType: "packing_list",
      resourceId: pl.id,
      diff: { documentId: created.id },
    });
    return created;
  });
  ok(res, "Packing list generated and attached to the shipment", doc, 201);
});

export const generateCommercialInvoicePdf = catchAsync(async (req, res, next) => {
  const shipment = await loadTradeShipment(req, req.params.shipmentId);
  assertTradeWritable(shipment, "generate invoices");
  const inv = await prisma.tradeInvoice.findFirst({
    where: { id: req.params.invoiceId, shipmentId: shipment.id },
    include: { lines: { orderBy: { sortOrder: "asc" } }, sellerVendor: true, buyerVendor: true, bankVendor: true, financialInstrument: true },
  });
  if (!inv) return next(new AppError("Invoice not found on this shipment", 404));
  if (!inv.lines.length) return next(new AppError("An invoice with no lines cannot be rendered", 422));

  const file = await renderCommercialInvoicePdf({
    invoice: inv,
    shipment,
    seller: inv.sellerVendor,
    buyer: inv.buyerVendor,
    bank: inv.bankVendor,
    financialInstrument: inv.financialInstrument,
  });
  if (!file) return next(new AppError("PDF generation is unavailable — run `npm i pdfkit` in erp-backend", 503));

  const doc = await prisma.$transaction(async (tx) => {
    const created = await attachGenerated(tx, {
      file,
      shipment,
      docType: "commercial_invoice",
      actorId: req.user.id,
      previousDocumentId: inv.documentId,
    });
    await tx.tradeInvoice.update({ where: { id: inv.id }, data: { documentId: created.id } });
    await audit(tx, {
      actorId: req.user.id,
      action: "trade.invoice.generated",
      resourceType: "trade_invoice",
      resourceId: inv.id,
      diff: { documentId: created.id },
    });
    return created;
  });
  ok(res, "Commercial invoice generated and attached to the shipment", doc, 201);
});
