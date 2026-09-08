import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { shipmentInScope } from "../shipment/shipment.middleware.js";
import { emitShipmentEvent as emitEvent, auditShipment as audit } from "../shipment/shipment.service.js";

/**
 * Export trade documents — shared logic (Export Shipment Workflow roadmap §4–§8).
 *
 * These helpers run INSIDE a caller's transaction, like the shipment ones, so state +
 * audit + outbox commit together (INV-09).
 *
 * The rule that shapes this file: figures appearing on more than one document are
 * DERIVED from their one source, never stored twice (ADR-001). Packing-list totals come
 * from its items, an invoice total from its lines, an instrument's drawn amount from its
 * drawdowns, and the trade stage from which documents exist.
 */

export { emitEvent, audit };

// ── Reference numbers ────────────────────────────────────────────────────────
// utils/referenceNumber.js carries a closed PREFIXES map for the original entities.
// Trade documents add six more; kept here rather than widening that map, because these
// are documents rather than CRM records and the two vocabularies are unrelated.
const TRADE_PREFIXES = {
  trade_contract: "TCN",
  financial_instrument: "FI",
  packing_list: "PL",
  trade_invoice: "TIN",
  bill_of_lading: "BL",
  goods_declaration: "GD",
};

/**
 * Allocate inside the owning transaction so a rollback never burns a visible gap and
 * two concurrent creates cannot collide (INV-12). Same mechanism as allocateRef.
 */
export const allocateTradeRef = async (tx, entity) => {
  const prefix = TRADE_PREFIXES[entity];
  if (!prefix) throw new Error(`Unknown trade reference entity: ${entity}`);
  const year = new Date().getFullYear();
  const seq = await tx.referenceSequence.upsert({
    where: { entity_year: { entity, year } },
    create: { entity, year, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  return `${prefix}-${year}-${String(seq.lastValue).padStart(5, "0")}`;
};

// ── Scope ────────────────────────────────────────────────────────────────────

/**
 * Every trade document hangs off a shipment, so it inherits the shipment's row-level
 * scope. Out of scope reads 404, never 403 (BUSINESS_RULES §2.3).
 */
export const loadTradeShipment = async (req, shipmentId) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment || !(await shipmentInScope(req, shipment))) {
    throw new AppError("Shipment not found", 404);
  }
  return shipment;
};

/** Trade documents are history once the order is closed or cancelled. */
export const assertTradeWritable = (shipment, action = "change its trade documents") => {
  if (shipment.exceptionState === "cancelled") {
    throw new AppError(`This shipment was cancelled, so you can no longer ${action}.`, 409);
  }
  if (shipment.status === "closed") {
    throw new AppError(`This shipment is closed, so you can no longer ${action}.`, 409);
  }
  return true;
};

// ── Derived totals (ADR-001) ─────────────────────────────────────────────────

const dec = (v) => (v == null ? 0 : Number(v));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

export { dec, round2 };

/** Packing-list header totals are a sum of its items — never accepted from a client. */
export const recalcPackingListTotals = async (tx, packingListId) => {
  const items = await tx.packingListItem.findMany({ where: { packingListId } });
  return tx.packingList.update({
    where: { id: packingListId },
    data: {
      totalCartons: items.reduce((s, i) => s + (i.boxes ?? 0), 0),
      totalPieces: items.reduce((s, i) => s + (i.pieces ?? 0), 0),
      totalNetWeightKg: round3(items.reduce((s, i) => s + dec(i.netWeightKg), 0)),
      totalGrossWeightKg: round3(items.reduce((s, i) => s + dec(i.grossWeightKg), 0)),
    },
  });
};

/** Invoice total is a sum of its lines; each line amount is quantity × unitPrice. */
export const recalcTradeInvoiceTotal = async (tx, tradeInvoiceId) => {
  const lines = await tx.tradeInvoiceLine.findMany({ where: { tradeInvoiceId } });
  return tx.tradeInvoice.update({
    where: { id: tradeInvoiceId },
    data: { totalValue: round2(lines.reduce((s, l) => s + dec(l.amount), 0)) },
  });
};

/** `drawnAmount` mirrors the drawdown ledger and is never written by hand. */
export const recalcFiDrawn = async (tx, financialInstrumentId) => {
  const rows = await tx.financialInstrumentDrawdown.findMany({ where: { financialInstrumentId } });
  return tx.financialInstrument.update({
    where: { id: financialInstrumentId },
    data: { drawnAmount: round2(rows.reduce((s, r) => s + dec(r.amount), 0)) },
  });
};

// ── Trade stage (roadmap §7.1) ───────────────────────────────────────────────

/**
 * The roadmap's eight workflow states, in order. `none` is the pre-contract state a
 * freight-forwarding shipment stays in for ever.
 */
export const TRADE_STAGES = [
  "none",
  "contract_registered",
  "fi_active",
  "packing_list_confirmed",
  "commercial_invoice_raised",
  "booking_confirmed",
  "shipped_on_board",
  "logistics_settled",
  "payment_realised",
  "fi_closed",
];

/**
 * Recompute `shipments.trade_stage` from the documents that exist.
 *
 * DERIVED, never written by an endpoint — the same rule ADR-014 applies to `status`,
 * one level across. The stage is the HIGHEST satisfied rung rather than the last thing
 * that happened, so a late-arriving document cannot walk the shipment backwards.
 *
 * Runs inside `tx`. Writes a history row and emits an event only on an actual change.
 */
export const recomputeTradeStage = async (tx, shipmentId, actorId) => {
  const shipment = await tx.shipment.findUnique({
    where: { id: shipmentId },
    select: { id: true, tradeStage: true, contractId: true, financialInstrumentId: true },
  });
  if (!shipment) return null;

  const [fi, packingList, invoices, bol, gd, payables] = await Promise.all([
    shipment.financialInstrumentId
      ? tx.financialInstrument.findUnique({ where: { id: shipment.financialInstrumentId } })
      : null,
    tx.packingList.findUnique({ where: { shipmentId } }),
    tx.tradeInvoice.findMany({ where: { shipmentId, status: "issued" } }),
    tx.billOfLading.findUnique({ where: { shipmentId } }),
    tx.goodsDeclaration.findUnique({ where: { shipmentId } }),
    tx.invoice.findMany({
      where: { shipmentId, kind: "payable", status: { not: "void" } },
      select: { status: true },
    }),
  ]);

  const satisfied = new Set(["none"]);
  if (shipment.contractId) satisfied.add("contract_registered");
  if (fi && ["active", "expired", "closed"].includes(fi.status)) satisfied.add("fi_active");
  if (packingList?.confirmedAt) satisfied.add("packing_list_confirmed");
  if (invoices.length) satisfied.add("commercial_invoice_raised");
  // Booking is confirmed once the carrier has given a booking number, or the declaration
  // has been filed — whichever the desk reaches first (roadmap Step 4).
  if (bol?.bookingNo || gd?.filedAt) satisfied.add("booking_confirmed");
  if (bol?.shippedOnBoard) satisfied.add("shipped_on_board");
  // Only meaningful once at least one logistics bill exists: a shipment with no payables
  // has not "settled" them, it simply has none yet.
  if (payables.length && payables.every((i) => i.status === "paid")) satisfied.add("logistics_settled");

  const saleValue = invoices
    .filter((i) => i.side === "sale")
    .reduce((s, i) => s + dec(i.totalValue), 0);
  if (fi && saleValue > 0 && dec(fi.drawnAmount) + 0.005 >= saleValue) satisfied.add("payment_realised");
  if (fi?.status === "closed") satisfied.add("fi_closed");

  let derived = "none";
  for (const stage of TRADE_STAGES) if (satisfied.has(stage)) derived = stage;

  if (derived !== shipment.tradeStage) {
    await tx.shipment.update({ where: { id: shipmentId }, data: { tradeStage: derived } });
    await tx.shipmentTradeStageHistory.create({
      data: { shipmentId, fromStage: shipment.tradeStage, toStage: derived, actorId: actorId ?? null },
    });
    await emitEvent(tx, "shipment.trade_stage.changed", {
      shipmentId,
      fromStage: shipment.tradeStage,
      toStage: derived,
    });
  }
  return derived;
};

// ── Automatic flags (roadmap §7.2) ───────────────────────────────────────────

/** Relative difference between two numbers, or null when either is missing. */
const variance = (a, b) => {
  const x = dec(a);
  const y = dec(b);
  if (!x || !y) return null;
  return Math.abs(x - y) / Math.max(x, y);
};

export const MISMATCH_TOLERANCE = 0.01; // 1% — the sample documents disagree by less

/**
 * The three checks §7.2 asks for, computed on demand for one shipment:
 *   · Financial Instrument expiry approaching or passed
 *   · DA maturity = B/L shipped-on-board + the instrument's daDays
 *   · Packing List vs Commercial Invoice vs B/L weight and quantity mismatches
 *
 * Reported, never enforced. The desk needs to SEE that the B/L and the packing list
 * disagree — not to be blocked from recording the B/L that says so.
 */
export const tradeAlertsFor = async (shipmentId) => {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: { id: true, financialInstrumentId: true, tradeStage: true },
  });
  if (!shipment) return [];

  const [fi, packingList, invoices, bol] = await Promise.all([
    shipment.financialInstrumentId
      ? prisma.financialInstrument.findUnique({ where: { id: shipment.financialInstrumentId } })
      : null,
    prisma.packingList.findUnique({ where: { shipmentId }, include: { items: true } }),
    prisma.tradeInvoice.findMany({ where: { shipmentId, status: { not: "void" } }, include: { lines: true } }),
    prisma.billOfLading.findUnique({ where: { shipmentId } }),
  ]);

  const alerts = [];
  const now = new Date();
  const DAY = 24 * 60 * 60 * 1000;

  if (fi && fi.status === "active") {
    const days = Math.ceil((new Date(fi.expiryDate) - now) / DAY);
    if (days < 0) {
      alerts.push({
        code: "fi_expired",
        severity: "error",
        message: `Financial Instrument ${fi.fiNumber} expired ${Math.abs(days)} day(s) ago.`,
      });
    } else if (days <= 14) {
      alerts.push({
        code: "fi_expiring",
        severity: "warning",
        message: `Financial Instrument ${fi.fiNumber} expires in ${days} day(s).`,
      });
    }
    const remaining = dec(fi.value) - dec(fi.drawnAmount);
    if (remaining < 0) {
      alerts.push({
        code: "fi_overdrawn",
        severity: "error",
        message: `Drawdowns exceed the instrument value by ${round2(-remaining)} ${fi.currency}.`,
      });
    }
  }

  // "75 days from B/L date" — computed, never entered (§7.2).
  if (fi?.daDays && bol?.shippedOnBoard) {
    const due = new Date(new Date(bol.shippedOnBoard).getTime() + fi.daDays * DAY);
    const days = Math.ceil((due - now) / DAY);
    if (days < 0) {
      alerts.push({
        code: "da_overdue",
        severity: "error",
        message: `DA payment was due ${Math.abs(days)} day(s) ago (${due.toISOString().slice(0, 10)}).`,
        dueDate: due,
      });
    } else if (days <= 14) {
      alerts.push({
        code: "da_due",
        severity: "warning",
        message: `DA payment falls due in ${days} day(s) (${due.toISOString().slice(0, 10)}).`,
        dueDate: due,
      });
    }
  }

  // Mismatch checks — the roadmap notes small variances appeared across the real set.
  if (packingList && bol) {
    const v = variance(packingList.totalGrossWeightKg, bol.grossWeightKg);
    if (v !== null && v > MISMATCH_TOLERANCE) {
      alerts.push({
        code: "weight_mismatch",
        severity: "warning",
        message: `Packing list gross weight (${packingList.totalGrossWeightKg} kg) and Bill of Lading gross weight (${bol.grossWeightKg} kg) differ by ${(v * 100).toFixed(1)}%.`,
      });
    }
  }
  if (packingList?.items?.length) {
    const plPieces = packingList.items.reduce((s, i) => s + (i.pieces ?? 0), 0);
    for (const inv of invoices) {
      if (!inv.lines.length) continue;
      const invQty = inv.lines.reduce((s, l) => s + dec(l.quantity), 0);
      const v = variance(plPieces, invQty);
      if (v !== null && v > MISMATCH_TOLERANCE) {
        alerts.push({
          code: "quantity_mismatch",
          severity: "warning",
          message: `Packing list total pieces (${plPieces}) and invoice ${inv.invoiceNo} total quantity (${invQty}) differ by ${(v * 100).toFixed(1)}%.`,
        });
      }
    }
  }
  if (fi) {
    for (const inv of invoices) {
      if (inv.financialInstrumentId !== fi.id) continue;
      if (dec(inv.totalValue) > dec(fi.value) + 0.005) {
        alerts.push({
          code: "invoice_exceeds_fi",
          severity: "error",
          message: `Invoice ${inv.invoiceNo} (${inv.totalValue} ${inv.currency}) exceeds the instrument ceiling of ${fi.value} ${fi.currency}.`,
        });
      }
    }
  }

  return alerts;
};
