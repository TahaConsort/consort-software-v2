import crypto from "crypto";
import prisma from "../config/prisma.js";

/**
 * Scheduled sweeps (WORKFLOW §14) — the subset whose entities exist today:
 *
 *   Lead staleness   14d without outreach → lead.stale (owner; ASM at 30d)
 *   Query staleness  14d without a quotation → query.stale (BDO, ASM)
 *   Query expiry     90d without a quotation → status `expired` (§3 machine)
 *
 * The spec runs these nightly; here they run hourly with per-entity dedupe
 * (an event is not re-emitted within REMIND_EVERY), which is idempotent and
 * safe (RULE-AE-04) — the extra runs just make dev feedback immediate.
 * Every emission goes through the outbox so the relay handles delivery.
 */

const SWEEP_MS = 60 * 60 * 1000; // hourly
const DAY = 24 * 60 * 60 * 1000;
const STALE_DAYS = 14;
const ESCALATE_DAYS = 30;
const EXPIRE_DAYS = 90;
const REMIND_EVERY = 7 * DAY; // don't re-nag the same record within a week

const emit = (eventType, payload) =>
  prisma.outboxEvent.create({
    data: { eventType, payload, correlationId: crypto.randomUUID() },
  });

// True if this event type was already emitted for this entity recently.
const recentlyEmitted = async (eventType, idField, id) => {
  const prior = await prisma.outboxEvent.findFirst({
    where: {
      eventType,
      createdAt: { gt: new Date(Date.now() - REMIND_EVERY) },
      payload: { path: [idField], equals: id },
    },
    select: { id: true },
  });
  return !!prior;
};

/* ── Lead staleness (nightly 01:00 in the target design) ── */
const sweepLeadStaleness = async () => {
  const openLeads = await prisma.lead.findMany({
    where: { status: { in: ["new", "contacted", "qualified"] } },
    select: { id: true, referenceNo: true, ownerId: true, createdAt: true },
  });

  for (const lead of openLeads) {
    const lastTouch = await prisma.outreach.findFirst({
      where: { leadId: lead.id },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });
    const anchor = lastTouch?.occurredAt ?? lead.createdAt;
    const days = Math.floor((Date.now() - anchor.getTime()) / DAY);
    if (days < STALE_DAYS) continue;
    if (await recentlyEmitted("lead.stale", "leadId", lead.id)) continue;

    await emit("lead.stale", {
      leadId: lead.id,
      referenceNo: lead.referenceNo,
      ownerId: lead.ownerId,
      days,
      escalate: days >= ESCALATE_DAYS, // 30d → ASM too
    });
  }
};

/* ── Query staleness + expiry (nightly 01:05 / §3 machine) ── */
const sweepQueries = async () => {
  const openQueries = await prisma.query.findMany({
    where: { status: "open" },
    select: { id: true, referenceNo: true, raisedById: true, createdAt: true },
  });

  for (const query of openQueries) {
    const days = Math.floor((Date.now() - query.createdAt.getTime()) / DAY);

    if (days >= EXPIRE_DAYS) {
      // open → expired: no quotation within 90 days (WORKFLOW §3).
      await prisma.$transaction([
        prisma.query.update({ where: { id: query.id }, data: { status: "expired" } }),
        prisma.outboxEvent.create({
          data: {
            eventType: "query.expired",
            payload: { queryId: query.id, referenceNo: query.referenceNo, raisedById: query.raisedById },
            correlationId: crypto.randomUUID(),
          },
        }),
      ]);
      continue;
    }

    if (days >= STALE_DAYS && !(await recentlyEmitted("query.stale", "queryId", query.id))) {
      await emit("query.stale", {
        queryId: query.id,
        referenceNo: query.referenceNo,
        raisedById: query.raisedById,
        days,
      });
    }
  }
};

/* ── Quotation expiry + 48h warning (RULE-QT-06, nightly 00:15/00:20) ── */
const sweepQuotations = async () => {
  const now = new Date();

  // sent past validityDate → expired; the query returns to revision_requested (§6).
  const dead = await prisma.quotation.findMany({
    where: { status: "sent", validityDate: { lt: now } },
    select: { id: true, referenceNo: true, queryId: true, createdById: true },
  });
  for (const q of dead) {
    await prisma.$transaction([
      prisma.quotation.update({ where: { id: q.id }, data: { status: "expired", rowVersion: { increment: 1 } } }),
      prisma.query.update({ where: { id: q.queryId }, data: { status: "revision_requested" } }),
      prisma.outboxEvent.create({
        data: {
          eventType: "quotation.expired",
          payload: { quotationId: q.id, referenceNo: q.referenceNo, queryId: q.queryId, createdById: q.createdById },
          correlationId: crypto.randomUUID(),
        },
      }),
    ]);
  }

  // 48h before expiry → quotation.expiring warning (deduped).
  const soon = await prisma.quotation.findMany({
    where: { status: "sent", validityDate: { gte: now, lt: new Date(now.getTime() + 2 * DAY) } },
    select: { id: true, referenceNo: true, queryId: true, createdById: true, validityDate: true },
  });
  for (const q of soon) {
    if (await recentlyEmitted("quotation.expiring", "quotationId", q.id)) continue;
    await emit("quotation.expiring", {
      quotationId: q.id,
      referenceNo: q.referenceNo,
      queryId: q.queryId,
      createdById: q.createdById,
      validityDate: q.validityDate,
    });
  }
};

/* ── Invoice overdue (nightly 01:10) — 7d → chase, 30d → escalate ── */
const sweepInvoices = async () => {
  const overdue = await prisma.invoice.findMany({
    where: { status: { in: ["issued", "part_paid"] }, dueDate: { lt: new Date(Date.now() - 7 * DAY) } },
    select: { id: true, referenceNo: true, shipmentId: true, dueDate: true },
  });
  for (const inv of overdue) {
    if (await recentlyEmitted("invoice.overdue", "invoiceId", inv.id)) continue;
    const days = Math.floor((Date.now() - inv.dueDate.getTime()) / DAY);
    await emit("invoice.overdue", {
      invoiceId: inv.id,
      referenceNo: inv.referenceNo,
      shipmentId: inv.shipmentId,
      days,
      escalate: days >= 30, // 30d → Management
    });
  }
};

/* ── Overdue task sweep (hourly, RULE-TK-03) — held tasks exempt. Queued
   (department-queue) tasks are included so unclaimed work still escalates. ── */
const sweepTasks = async () => {
  const overdue = await prisma.task.findMany({
    where: { status: { in: ["queued", "open", "in_progress"] }, slaPausedAt: null, dueDate: { lt: new Date() } },
    select: { id: true, title: true, assigneeId: true, departmentId: true, dueDate: true },
  });
  for (const t of overdue) {
    if (await recentlyEmitted("task.overdue", "taskId", t.id)) continue;
    const hours = Math.floor((Date.now() - t.dueDate.getTime()) / (60 * 60 * 1000));
    await emit("task.overdue", {
      taskId: t.id,
      title: t.title,
      assigneeId: t.assigneeId,
      departmentId: t.departmentId,
      hours,
      escalate: hours >= 48, // 48h → Management (RULE-TK-03)
    });
  }
};

/* ── ETA breach (nightly 01:15) — ETA passed, still undelivered ── */
const sweepEta = async () => {
  const breached = await prisma.shipment.findMany({
    where: {
      eta: { lt: new Date() },
      status: { notIn: ["delivered", "settled", "closed"] },
      exceptionState: "none",
    },
    select: { id: true, referenceNo: true, customerId: true, eta: true, status: true },
  });
  for (const s of breached) {
    if (await recentlyEmitted("shipment.eta_breached", "shipmentId", s.id)) continue;
    await emit("shipment.eta_breached", {
      shipmentId: s.id,
      referenceNo: s.referenceNo,
      customerId: s.customerId,
      eta: s.eta,
      status: s.status,
    });
  }
};

/* ── Load board posting expiry (nightly 02:20, CRM_MASTER §5.20) ── */
const sweepLoadBoard = async () => {
  await prisma.loadBoardPosting.updateMany({
    where: { status: "open", validUntil: { lt: new Date() } },
    data: { status: "expired" },
  });
};

/* ── Outbox reaper (nightly 02:00) — dispatched rows older than 30d ── */
const reapOutbox = async () => {
  await prisma.outboxEvent.deleteMany({
    where: { dispatchedAt: { not: null, lt: new Date(Date.now() - 30 * DAY) } },
  });
};

/* ── Document orphan sweep (nightly 02:30, EDGE-D-04) + soft-delete purge ── */
const sweepDocumentOrphans = async () => {
  let uploadRoot;
  try {
    ({ UPLOAD_ROOT: uploadRoot } = await import("../modules/document/document.service.js"));
  } catch {
    return;
  }
  const fs = await import("fs");
  const path = await import("path");
  if (!fs.existsSync(uploadRoot)) return;

  const known = new Set(
    (await prisma.document.findMany({ select: { storageKey: true } })).map((d) => d.storageKey),
  );
  for (const file of fs.readdirSync(uploadRoot)) {
    const abs = path.join(uploadRoot, file);
    if (!fs.statSync(abs).isFile()) continue;
    // Orphan: on disk >24h with no committed row (EDGE-D-04).
    if (!known.has(file) && Date.now() - fs.statSync(abs).mtimeMs > DAY) {
      fs.promises.unlink(abs).catch(() => {});
    }
  }
  // Soft-deleted 30d ago → remove the storage object, keep the row (DATABASE §7).
  const purgeable = await prisma.document.findMany({
    where: { deletedAt: { lt: new Date(Date.now() - 30 * DAY) } },
    select: { storageKey: true },
  });
  for (const d of purgeable) {
    fs.promises.unlink(path.join(uploadRoot, d.storageKey)).catch(() => {});
  }
};

/* ── Retention pruning (weekly cadence, DATABASE §7) — daily-guarded ── */
let lastPruneAt = 0;
const pruneRetention = async () => {
  if (Date.now() - lastPruneAt < 7 * DAY) return;
  lastPruneAt = Date.now();
  const now = Date.now();
  await prisma.loginActivity.deleteMany({ where: { createdAt: { lt: new Date(now - 365 * DAY) } } });
  await prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date(now - 30 * DAY) } }, { revokedAt: { lt: new Date(now - 30 * DAY) } }] },
  });
  await prisma.activationToken.deleteMany({
    where: { OR: [{ usedAt: { lt: new Date(now - 7 * DAY) } }, { expiresAt: { lt: new Date(now - 7 * DAY) } }] },
  });
  const pruneWhere = {
    OR: [
      { readAt: { lt: new Date(now - 180 * DAY) } },
      { readAt: null, createdAt: { lt: new Date(now - 365 * DAY) } },
    ],
  };
  await prisma.notificationDelivery.deleteMany({ where: { notification: pruneWhere } });
  await prisma.notification.deleteMany({ where: pruneWhere });
  // Chat: scrub soft-deleted bodies 30d after deletion, keep rows (DATABASE §7).
  await prisma.chatMessage.updateMany({
    where: { deletedAt: { lt: new Date(now - 30 * DAY) }, body: { not: "" } },
    data: { body: "" },
  });
};

// ── Export trade documents (roadmap §7.2) ────────────────────────────────────
// The three things the roadmap asks to be flagged automatically. Each is idempotent:
// the instrument and the B/L carry their own "already told you" timestamp, so an hourly
// run does not re-nag, and a restart never double-notifies.

const FI_WARN_DAYS = 14;

/** Financial Instrument expiry approaching, and expiry itself. */
const sweepFinancialInstruments = async () => {
  const now = new Date();
  const horizon = new Date(now.getTime() + FI_WARN_DAYS * DAY);

  // Past expiry — the status moves, which is a fact about the instrument rather than a
  // reminder, so it is applied whether or not anyone was notified before.
  const expired = await prisma.financialInstrument.findMany({
    where: { status: "active", expiryDate: { lt: now } },
    select: { id: true, fiNumber: true, expiryDate: true },
  });
  for (const fi of expired) {
    await prisma.financialInstrument.update({ where: { id: fi.id }, data: { status: "expired" } });
    await emit("fi.expiring", { financialInstrumentId: fi.id, fiNumber: fi.fiNumber, expired: true });
  }

  const soon = await prisma.financialInstrument.findMany({
    where: { status: "active", expiryDate: { gte: now, lte: horizon }, expiryNotifiedAt: null },
    select: { id: true, fiNumber: true, expiryDate: true },
  });
  for (const fi of soon) {
    await prisma.financialInstrument.update({ where: { id: fi.id }, data: { expiryNotifiedAt: now } });
    await emit("fi.expiring", {
      financialInstrumentId: fi.id,
      fiNumber: fi.fiNumber,
      daysLeft: Math.ceil((new Date(fi.expiryDate) - now) / DAY),
    });
  }
};

/**
 * DA maturity. The roadmap is explicit that "75 days from B/L date" must be computed
 * from the actual Bill of Lading date rather than typed in, so the due date is derived
 * here from shippedOnBoard + the instrument's daDays.
 */
const sweepDaMaturity = async () => {
  const now = new Date();
  const bols = await prisma.billOfLading.findMany({
    where: { shippedOnBoard: { not: null }, daNotifiedAt: null },
    select: { id: true, blNumber: true, shippedOnBoard: true, shipmentId: true },
  });
  for (const bol of bols) {
    const shipment = await prisma.shipment.findUnique({
      where: { id: bol.shipmentId },
      select: { financialInstrumentId: true },
    });
    if (!shipment?.financialInstrumentId) continue;
    const fi = await prisma.financialInstrument.findUnique({
      where: { id: shipment.financialInstrumentId },
      select: { id: true, daDays: true, status: true },
    });
    if (!fi?.daDays || fi.status === "closed") continue;

    const due = new Date(new Date(bol.shippedOnBoard).getTime() + fi.daDays * DAY);
    const daysLeft = Math.ceil((due - now) / DAY);
    if (daysLeft > FI_WARN_DAYS) continue;

    await prisma.billOfLading.update({ where: { id: bol.id }, data: { daNotifiedAt: now } });
    await emit("fi.da_due", {
      shipmentId: bol.shipmentId,
      financialInstrumentId: fi.id,
      blNumber: bol.blNumber,
      dueDate: due,
      daysLeft,
    });
  }
};

/**
 * Packing List vs Commercial Invoice vs B/L. Reported, never enforced — the desk needs
 * to see that two documents disagree, not to be stopped from recording the second one.
 */
const sweepTradeMismatch = async () => {
  const { tradeAlertsFor } = await import("../modules/trade/trade.service.js");
  const shipments = await prisma.shipment.findMany({
    where: { kind: "trade", status: { notIn: ["closed"] }, exceptionState: { not: "cancelled" } },
    select: { id: true, referenceNo: true },
  });
  for (const s of shipments) {
    if (await recentlyEmitted("trade.mismatch_detected", "shipmentId", s.id)) continue;
    const alerts = (await tradeAlertsFor(s.id)).filter((a) =>
      ["weight_mismatch", "quantity_mismatch", "invoice_exceeds_fi"].includes(a.code),
    );
    if (!alerts.length) continue;
    await emit("trade.mismatch_detected", { shipmentId: s.id, referenceNo: s.referenceNo, alerts });
  }
};

export const runSweepsOnce = async () => {
  await sweepLeadStaleness();
  await sweepQueries();
  await sweepQuotations();
  await sweepInvoices();
  await sweepTasks();
  await sweepEta();
  await sweepLoadBoard();
  await reapOutbox();
  await sweepDocumentOrphans();
  await sweepFinancialInstruments();
  await sweepDaMaturity();
  await sweepTradeMismatch();
  await pruneRetention();
};

let timer = null;

export const startScheduler = () => {
  if (timer) return;
  // First pass shortly after boot, then hourly.
  setTimeout(() => runSweepsOnce().catch((e) => console.error("Sweep error:", e.message)), 15_000).unref?.();
  timer = setInterval(() => {
    runSweepsOnce().catch((e) => console.error("Sweep error:", e.message));
  }, SWEEP_MS);
  timer.unref?.();
  console.log("Scheduled sweeps started (hourly)");
};
