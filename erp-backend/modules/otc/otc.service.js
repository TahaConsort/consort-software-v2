import crypto from "crypto";

/**
 * OTC — Order to Cash shared logic (CRM_MASTER §5.10, RULE-FI/RULE-SH-12).
 *
 * The ONE place that completes an OTC milestone and derives `settled` (ADR-001).
 * Both the Finance module (auto-completing milestones 1 & 2 on invoice issue and
 * full payment, RULE-FI-02/03) and the OTC module (manual milestones 3–5,
 * RULE-FI-04) call these — so the settle rule can never be encoded twice.
 *
 * Every helper runs INSIDE the caller's transaction (INV-09).
 */

/** The five OTC milestones, seeded on every shipment at approval (WORKFLOW §5.3). */
export const OTC_MILESTONE_TYPES = [
  "invoice_issued", // 1 — auto on invoice issue (RULE-FI-02)
  "payment_received", // 2 — auto on full settlement (RULE-FI-03)
  "credit_line_released", // 3 — manual, Accounts (RULE-FI-04)
  "bol_surrendered", // 4 — manual, Accounts
  "settlement_complete", // 5 — manual, Accounts
];

/** Which milestones complete automatically vs. manually. */
export const AUTO_MILESTONES = [1, 2];
export const MANUAL_MILESTONES = [3, 4, 5];

/** Complete a milestone by type (idempotent — only flips a still-pending row). */
export const completeMilestoneTx = (tx, shipmentId, type, completedById) =>
  tx.otcMilestone.updateMany({
    where: { shipmentId, type, status: "pending" },
    data: { status: "done", completedById: completedById ?? null, completedAt: new Date() },
  });

/**
 * The invoice ledger for one shipment — the money half of "fully complete".
 * Void invoices are excluded: commercially they never happened.
 * @returns {{ total, unissued, unpaid }} counts over the live invoices
 */
export const invoiceStateTx = async (tx, shipmentId) => {
  // Only the RECEIVABLE ledger drives OTC milestones and settlement — payables
  // (money we owe vendors) are tracked separately and never gate the order.
  const invoices = await tx.invoice.findMany({
    where: { shipmentId, kind: "receivable", status: { not: "void" } },
    select: { status: true },
  });
  return {
    total: invoices.length,
    unissued: invoices.filter((i) => i.status === "draft").length,
    unpaid: invoices.filter((i) => i.status !== "paid").length,
  };
};

/**
 * Derive `settled` — the point at which the order LOCKS (RULE-SH-12). Requires
 * all three to be true at once:
 *   1. every OTD step confirmed        → status is `delivered`
 *   2. all five OTC milestones done
 *   3. every live invoice fully paid   → nothing still owed
 *
 * (3) is checked against the ledger rather than trusting milestone 2, because a
 * second invoice can be raised after the first was paid. Never downgrades, and
 * never settles a shipment carrying no invoice at all. Writes status history.
 */
export const maybeSettleTx = async (tx, shipmentId, actorId) => {
  const shipment = await tx.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment || shipment.status !== "delivered") return shipment?.status;

  // Some steps derive `delivered` without being the last on the path (e.g.
  // `empty_return`, canonical 18, runs AFTER `delivered`, canonical 17). Never
  // settle-and-lock while any OTD step is still pending.
  const pendingSteps = await tx.otdStep.count({ where: { shipmentId, status: "pending" } });
  if (pendingSteps > 0) return shipment.status;

  const pending = await tx.otcMilestone.count({ where: { shipmentId, status: "pending" } });
  if (pending > 0) return shipment.status;

  const { total, unpaid } = await invoiceStateTx(tx, shipmentId);
  if (total === 0 || unpaid > 0) return shipment.status;

  await tx.shipment.update({ where: { id: shipmentId }, data: { status: "settled" } });
  await tx.shipmentStatusHistory.create({
    data: { shipmentId, fromStatus: "delivered", toStatus: "settled", actorId: actorId ?? null },
  });
  return "settled";
};

/** Emit a domain event inside `tx` (transactional outbox, ADR-021). */
export const emitOtcEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });
