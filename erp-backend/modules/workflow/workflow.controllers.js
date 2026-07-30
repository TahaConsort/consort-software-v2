import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { ShipmentStatus, DepartmentCode, ServicePackage, CroHandling, LcHandling, ServiceCode, StepActionKind } from "@prisma/client";
import {
  SERVICE_PACKAGE_LABELS,
  CRO_HANDLING_LABELS,
  LC_HANDLING_LABELS,
} from "../../utils/servicePackage.js";
import { STEP_CODE_RE } from "./workflow.validation.js";
import * as svc from "./workflow.service.js";

/**
 * Workflow catalog admin (ADR-051) at /api/workflow — Management-only CRUD over the
 * step catalog, its checklists and the document vocabulary. Edits shape NEW shipments
 * only: a composed path is frozen at approval (INV-14) and never recomposed.
 */

// Service-code labels for admin selects. Presentation only — the CATALOG in
// modules/service carries the customer-facing prose.
const SERVICE_LABELS = {
  local_transport: "Local Transport / Inland",
  customs_clearance: "Customs Clearance",
  sea_freight: "Sea Freight (Ocean)",
  port_handling: "Port Handling / Terminal",
  lc_finance: "LC / Trade Finance",
  destination_services: "Destination Services / Agent",
};

/* ── GET /api/workflow/meta ── everything the admin UI's selects need */
export const getMeta = catchAsync(async (req, res) => {
  const [departments, docTypes] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.documentType.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
  ]);
  res.json({
    success: true,
    data: {
      packages: Object.values(ServicePackage).map((code) => ({ code, label: SERVICE_PACKAGE_LABELS[code] ?? code })),
      croModes: Object.values(CroHandling).map((code) => ({ code, label: CRO_HANDLING_LABELS[code] ?? code })),
      lcModes: Object.values(LcHandling).map((code) => ({ code, label: LC_HANDLING_LABELS[code] ?? code })),
      services: Object.values(ServiceCode).map((code) => ({ code, label: SERVICE_LABELS[code] ?? code })),
      departments: departments.map((d) => ({ code: d.code, name: d.name })),
      statuses: Object.values(ShipmentStatus),
      actionKinds: Object.values(StepActionKind),
      docTypes: docTypes.map((t) => ({
        code: t.code,
        label: t.label,
        customerUploadable: t.customerUploadable,
        active: t.active,
      })),
      stepCodePattern: STEP_CODE_RE.source,
    },
  });
});

/* ── GET /api/workflow/steps ── the whole catalog, inactive included, with usage */
export const listSteps = catchAsync(async (req, res) => {
  const steps = await prisma.otdStepTemplate.findMany({
    orderBy: { canonicalNo: "asc" },
    include: { actions: { orderBy: { sortOrder: "asc" } } },
  });
  // Two grouped counts instead of 2×N queries.
  const [stepCounts, chargeCounts] = await Promise.all([
    prisma.otdStep.groupBy({ by: ["stepCode"], _count: { _all: true } }),
    prisma.chargeType.groupBy({ by: ["defaultStepCode"], _count: { _all: true }, where: { defaultStepCode: { not: null } } }),
  ]);
  const usageOf = (code) => ({
    shipmentSteps: stepCounts.find((c) => c.stepCode === code)?._count._all ?? 0,
    chargeTypes: chargeCounts.find((c) => c.defaultStepCode === code)?._count._all ?? 0,
  });
  res.json({ success: true, data: steps.map((s) => ({ ...s, usage: usageOf(s.stepCode) })) });
});

/* ── POST /api/workflow/steps ── */
export const createStep = catchAsync(async (req, res, next) => {
  try {
    const created = await svc.createStep(req.body, req.user.id);
    res.status(201).json({ success: true, message: `Step "${created.title}" created`, data: created });
  } catch (e) {
    if (e?.code === "P2002") {
      return next(new AppError("That step code or canonical number is already in use", 409));
    }
    throw e;
  }
});

/* ── PATCH /api/workflow/steps/:stepCode ── */
export const updateStep = catchAsync(async (req, res, next) => {
  if (!Object.keys(req.body).length) return next(new AppError("Nothing to update", 400));
  try {
    const updated = await svc.updateStep(req.params.stepCode, req.body, req.user.id);
    res.json({ success: true, message: "Step updated — applies to new shipments only", data: updated });
  } catch (e) {
    if (e?.code === "P2002") {
      return next(new AppError("That canonical number is already in use", 409));
    }
    throw e;
  }
});

/* ── DELETE /api/workflow/steps/:stepCode ── */
export const deleteStep = catchAsync(async (req, res) => {
  const result = await svc.deleteStep(req.params.stepCode, req.user.id);
  res.json({ success: true, message: "Step deleted", data: result });
});

/* ── PUT /api/workflow/steps/:stepCode/actions ── replace the whole checklist */
export const replaceActions = catchAsync(async (req, res) => {
  const actions = await svc.replaceActions(req.params.stepCode, req.body.actions, req.user.id);
  res.json({ success: true, message: "Checklist updated — applies to new shipments only", data: actions });
});

/* ── GET /api/workflow/doc-types ── inactive included, with usage */
export const listDocTypes = catchAsync(async (req, res) => {
  const rows = await prisma.documentType.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  const withUsage = await Promise.all(rows.map(async (t) => ({ ...t, usage: await svc.docTypeUsage(t.code) })));
  res.json({ success: true, data: withUsage });
});

/* ── POST /api/workflow/doc-types ── */
export const createDocType = catchAsync(async (req, res, next) => {
  try {
    const created = await svc.createDocType(req.body, req.user.id);
    res.status(201).json({ success: true, message: `Document type "${created.label}" created`, data: created });
  } catch (e) {
    if (e?.code === "P2002") return next(new AppError("That document type code already exists", 409));
    throw e;
  }
});

/* ── PATCH /api/workflow/doc-types/:code ── */
export const updateDocType = catchAsync(async (req, res, next) => {
  if (!Object.keys(req.body).length) return next(new AppError("Nothing to update", 400));
  const updated = await svc.updateDocType(req.params.code, req.body, req.user.id);
  res.json({ success: true, message: "Document type updated", data: updated });
});

/* ── DELETE /api/workflow/doc-types/:code ── */
export const deleteDocType = catchAsync(async (req, res) => {
  const result = await svc.deleteDocType(req.params.code, req.user.id);
  res.json({ success: true, message: "Document type deleted", data: result });
});

/* ── GET /api/workflow/validate ── catalog lint (warnings, not blocks) */
export const validateCatalog = catchAsync(async (req, res) => {
  const report = await svc.validateCatalog();
  const issueCount =
    report.combos.filter((c) => c.issues.length).length +
    report.danglingDocTypes.length +
    report.neverComposed.length;
  res.json({
    success: true,
    message: issueCount ? `${issueCount} finding(s) — review below` : "Catalog looks healthy",
    data: report,
  });
});
