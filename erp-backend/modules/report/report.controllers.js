import prisma from "../../config/prisma.js";
import { catchAsync } from "../../utils/catchAsync.js";

/**
 * Reports (CRM_MASTER §5.18, ADR-006). Read-only aggregations, scoped to the
 * live role (§5.17). Revenue always aggregates `invoices` + `payments` — OTC
 * milestone amounts are display mirrors, never a report input (ADR-001/ADR-006).
 *
 * Formats: JSON (default) and CSV (native). XLSX and PDF are produced via
 * OPTIONAL deps (exceljs / pdfkit) — 501 with an install hint if absent, so the
 * app runs without them (the user installs packages manually). Result sets over
 * ASYNC_THRESHOLD are refused for synchronous file export (CRM_MASTER §5.18 —
 * the async>5000-row pipeline is Phase-2).
 */

const ASYNC_THRESHOLD = 5000;

// ── native CSV (no library) ─────────────────────────────────────────────────
const toCsv = (rows) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
};

const sendXlsx = async (res, name, rows) => {
  let ExcelJS;
  try {
    ({ default: ExcelJS } = await import("exceljs"));
  } catch {
    return res.status(501).json({ success: false, message: "XLSX export needs exceljs — run `npm i exceljs`." });
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name);
  if (rows.length) {
    ws.columns = Object.keys(rows[0]).map((k) => ({ header: k, key: k }));
    rows.forEach((r) => ws.addRow(r));
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
};

const sendPdf = async (res, name, rows) => {
  let PDFDocument;
  try {
    ({ default: PDFDocument } = await import("pdfkit"));
  } catch {
    return res.status(501).json({ success: false, message: "PDF export needs pdfkit — run `npm i pdfkit`." });
  }
  const doc = new PDFDocument({ margin: 36, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.pdf"`);
  doc.pipe(res);
  doc.fontSize(16).text(`${name} report`, { underline: true }).moveDown();
  doc.fontSize(9);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  if (headers.length) doc.font("Helvetica-Bold").text(headers.join("  |  ")).font("Helvetica");
  rows.forEach((r) => doc.text(headers.map((h) => String(r[h] ?? "")).join("  |  ")));
  if (!rows.length) doc.text("No data.");
  doc.end();
};

const send = async (req, res, name, rows, summary) => {
  const fmt = req.query.format;
  if (fmt && fmt !== "json" && rows.length > ASYNC_THRESHOLD) {
    return res.status(413).json({
      success: false,
      message: `Result set (${rows.length}) exceeds the ${ASYNC_THRESHOLD}-row synchronous export limit; narrow the date range (async export is Phase-2).`,
    });
  }
  if (fmt === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
    return res.send(toCsv(rows));
  }
  if (fmt === "xlsx") return sendXlsx(res, name, rows);
  if (fmt === "pdf") return sendPdf(res, name, rows);
  res.json({ success: true, report: name, data: rows, summary: summary ?? null });
};

// Optional createdAt window from ?from&?to.
const dateWhere = (req) => {
  const w = {};
  if (req.query.from) w.gte = new Date(req.query.from);
  if (req.query.to) w.lte = new Date(req.query.to);
  return Object.keys(w).length ? w : undefined;
};

/* ── GET /api/reports/leads ── funnel + loss reasons (RULE-LD-06) */
export const leadsReport = catchAsync(async (req, res) => {
  const scope = req.reportScope;
  const where = {};
  const createdAt = dateWhere(req);
  if (createdAt) where.createdAt = createdAt;
  if (scope.ownerIds) where.ownerId = { in: scope.ownerIds };
  if (scope.departmentCode) where.id = "__none__"; // non-sales depts don't own leads

  const [byStatus, lost] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["lostReason"], where: { ...where, status: "lost" }, _count: { _all: true } }),
  ]);

  const rows = byStatus.map((r) => ({ status: r.status, count: r._count._all }));
  const lossReasons = lost.map((r) => ({ lostReason: r.lostReason ?? "(unspecified)", count: r._count._all }));
  return send(req, res, "leads", rows, { lossReasons, total: rows.reduce((a, r) => a + r.count, 0) });
});

/* ── GET /api/reports/shipments ── status distribution, exceptions, step durations */
export const shipmentsReport = catchAsync(async (req, res) => {
  const scope = req.reportScope;
  const where = {};
  const createdAt = dateWhere(req);
  if (createdAt) where.createdAt = createdAt;
  if (scope.customerIds) where.customerId = { in: scope.customerIds };
  if (scope.departmentCode) where.otdSteps = { some: { ownerDepartment: scope.departmentCode } };

  const [byStatus, exceptions, holdAgg, shipments] = await Promise.all([
    prisma.shipment.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.shipmentException.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.shipment.aggregate({ where, _avg: { totalHoldMinutes: true } }),
    prisma.shipment.findMany({ where, select: { id: true, createdAt: true } }),
  ]);

  // Average time from shipment creation to each step completion (hours).
  const shipmentIds = shipments.map((s) => s.id);
  const createdById = new Map(shipments.map((s) => [s.id, s.createdAt]));
  const steps = shipmentIds.length
    ? await prisma.otdStep.findMany({
        where: { shipmentId: { in: shipmentIds }, status: "done", completedAt: { not: null } },
        select: { stepCode: true, shipmentId: true, completedAt: true },
      })
    : [];
  const durAcc = {};
  for (const s of steps) {
    const created = createdById.get(s.shipmentId);
    if (!created) continue;
    const hrs = (s.completedAt - created) / 3_600_000;
    (durAcc[s.stepCode] ??= []).push(hrs);
  }
  const stepDurations = Object.entries(durAcc).map(([stepCode, arr]) => ({
    stepCode,
    completions: arr.length,
    avgHoursFromStart: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10,
  }));

  const rows = byStatus.map((r) => ({ status: r.status, count: r._count._all }));
  return send(req, res, "shipments", rows, {
    exceptionFrequency: exceptions.map((e) => ({ type: e.type, count: e._count._all })),
    avgHoldMinutes: Math.round(holdAgg._avg.totalHoldMinutes ?? 0),
    stepDurations,
    total: rows.reduce((a, r) => a + r.count, 0),
  });
});

/* ── GET /api/reports/revenue ── invoiced vs collected + ageing (ADR-006) */
export const revenueReport = catchAsync(async (req, res) => {
  const [invoiced, collected, open] = await Promise.all([
    prisma.invoice.aggregate({ where: { status: { in: ["issued", "part_paid", "paid"] } }, _sum: { totalAmount: true } }),
    prisma.payment.aggregate({ _sum: { amount: true } }),
    prisma.invoice.findMany({
      where: { status: { in: ["issued", "part_paid"] } },
      select: { referenceNo: true, totalAmount: true, dueDate: true, status: true, payments: { select: { amount: true } } },
    }),
  ]);

  const now = Date.now();
  const buckets = { current: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const rows = open.map((inv) => {
    const paid = inv.payments.reduce((a, p) => a + Number(p.amount), 0);
    const outstanding = Number(inv.totalAmount) - paid;
    const overdueDays = inv.dueDate ? Math.floor((now - new Date(inv.dueDate)) / 86_400_000) : 0;
    if (overdueDays <= 30) buckets.current += outstanding;
    else if (overdueDays <= 60) buckets.d31_60 += outstanding;
    else if (overdueDays <= 90) buckets.d61_90 += outstanding;
    else buckets.d90_plus += outstanding;
    return { referenceNo: inv.referenceNo, status: inv.status, outstanding: Math.round(outstanding * 100) / 100, overdueDays };
  });

  return send(req, res, "revenue", rows, {
    invoiced: Number(invoiced._sum.totalAmount ?? 0),
    collected: Number(collected._sum.amount ?? 0),
    outstanding: Math.round(rows.reduce((a, r) => a + r.outstanding, 0) * 100) / 100,
    ageing: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, Math.round(v * 100) / 100])),
  });
});

/* ── GET /api/reports/tasks ── open/overdue by department */
export const tasksReport = catchAsync(async (req, res) => {
  const scope = req.reportScope;
  const deptFilter = scope.departmentCode
    ? await prisma.department.findUnique({ where: { code: scope.departmentCode }, select: { id: true } })
    : null;
  const base = deptFilter ? { departmentId: deptFilter.id } : {};

  const [byStatus, overdue] = await Promise.all([
    prisma.task.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    prisma.task.count({ where: { ...base, status: { in: ["open", "in_progress"] }, dueDate: { lt: new Date() } } }),
  ]);
  const rows = byStatus.map((r) => ({ status: r.status, count: r._count._all }));
  return send(req, res, "tasks", rows, { overdue, total: rows.reduce((a, r) => a + r.count, 0) });
});

/* ── GET /api/reports/outreach ── touches by type & outcome */
export const outreachReport = catchAsync(async (req, res) => {
  const scope = req.reportScope;
  const where = {};
  const occurredAt = dateWhere(req);
  if (occurredAt) where.occurredAt = occurredAt;
  if (scope.ownerIds) where.actorId = { in: scope.ownerIds };
  if (scope.departmentCode) where.id = "__none__"; // non-sales depts log no outreach

  const [byType, byOutcome] = await Promise.all([
    prisma.outreach.groupBy({ by: ["type"], where, _count: { _all: true } }),
    prisma.outreach.groupBy({ by: ["outcome"], where, _count: { _all: true } }),
  ]);
  const rows = byType.map((r) => ({ type: r.type, count: r._count._all }));
  return send(req, res, "outreach", rows, {
    byOutcome: byOutcome.map((r) => ({ outcome: r.outcome, count: r._count._all })),
    total: rows.reduce((a, r) => a + r.count, 0),
  });
});

/* ── GET /api/reports/unserved-demand ── cancelled/expired queries by reason (RULE-QRY-03) */
export const unservedDemandReport = catchAsync(async (req, res) => {
  const scope = req.reportScope;
  const where = { status: { in: ["cancelled", "expired", "rejected"] } };
  const createdAt = dateWhere(req);
  if (createdAt) where.createdAt = createdAt;
  if (scope.customerIds) where.customerId = { in: scope.customerIds };

  const queries = await prisma.query.findMany({
    where,
    select: { referenceNo: true, status: true, cancelReason: true, services: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const rows = queries.map((q) => ({
    referenceNo: q.referenceNo,
    status: q.status,
    reason: q.cancelReason ?? "(none)",
    services: (q.services ?? []).join("|"),
  }));
  const byReason = {};
  for (const q of queries) byReason[q.cancelReason ?? "(none)"] = (byReason[q.cancelReason ?? "(none)"] ?? 0) + 1;
  return send(req, res, "unserved-demand", rows, {
    byReason: Object.entries(byReason).map(([reason, count]) => ({ reason, count })),
    total: rows.length,
  });
});
