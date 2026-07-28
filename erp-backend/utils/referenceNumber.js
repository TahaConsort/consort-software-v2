/**
 * Reference-number allocation (DATABASE §1 conventions, INV-12).
 * Numbers are allocated from `reference_sequences` INSIDE the owning
 * transaction, so a rollback never burns a visible gap and two concurrent
 * creates can't collide (the row update serialises them).
 *
 * Usage:  const ref = await allocateRef(tx, "lead");   // → "LED-2026-00001"
 */

const PREFIXES = {
  lead: "LED",
  customer: "CST",
  query: "QRY",
  quotation: "QT",
  shipment: "SHIP",
  invoice: "INV",
  inquiry: "INQ", // public storefront request (CRM_MASTER §5.20)
  lc_referral: "LC", // bank LC intake webhook (CRM_MASTER §5.21)
  load_board: "LB", // load board posting (CRM_MASTER §5.20)
  vendor: "VEN", // vendor/carrier master (freight-forwarding OTC upgrade)
};

export const allocateRef = async (tx, entity) => {
  const prefix = PREFIXES[entity];
  if (!prefix) throw new Error(`Unknown reference entity: ${entity}`);

  const year = new Date().getFullYear();
  const seq = await tx.referenceSequence.upsert({
    where: { entity_year: { entity, year } },
    create: { entity, year, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });

  return `${prefix}-${year}-${String(seq.lastValue).padStart(5, "0")}`;
};
