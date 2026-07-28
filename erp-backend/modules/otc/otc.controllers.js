import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { shipmentInScope } from "./otc.middleware.js";
import { completeMilestoneTx, maybeSettleTx, MANUAL_MILESTONES } from "./otc.service.js";
import { auditShipment, assertShipmentUnlocked } from "../shipment/shipment.service.js";

/**
 * OTC — Order to Cash (CRM_MASTER §5.10, WORKFLOW §5.3, RULE-FI-04).
 *
 * Five financial milestones per shipment. 1 (Invoice Issued) and 2 (Payment
 * Received) complete AUTOMATICALLY from the Finance module (RULE-FI-02/03) via
 * the shared otc.service; this module records the manual milestones 3–5, in
 * order, and derives `settled` once delivered + all five are done (RULE-SH-12).
 */

/** Load a shipment and enforce row-level scope, or 404 (BUSINESS_RULES §2.3). */
const loadShipmentInScope = async (req, next) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.shipmentId } });
  if (!shipment || !(await shipmentInScope(req, shipment))) {
    next(new AppError("Shipment not found", 404));
    return null;
  }
  return shipment;
};

/* ── GET /api/otc/:shipmentId/milestones ── */
export const listMilestones = catchAsync(async (req, res, next) => {
  const shipment = await loadShipmentInScope(req, next);
  if (!shipment) return;
  const milestones = await prisma.otcMilestone.findMany({
    where: { shipmentId: shipment.id },
    orderBy: { milestoneNo: "asc" },
  });
  res.json({
    success: true,
    data: {
      shipmentId: shipment.id,
      referenceNo: shipment.referenceNo,
      status: shipment.status,
      milestones,
    },
  });
});

/* ── POST /api/otc/:shipmentId/milestones/:milestoneNo/complete ── (RULE-FI-04) */
export const completeMilestone = catchAsync(async (req, res, next) => {
  const milestoneNo = Number(req.params.milestoneNo);
  if (!MANUAL_MILESTONES.includes(milestoneNo)) {
    return next(new AppError("Milestones 1–2 complete automatically; only 3–5 are recorded manually (RULE-FI-04)", 422));
  }

  const shipment = await loadShipmentInScope(req, next);
  if (!shipment) return;
  if (shipment.exceptionState === "on_hold") return next(new AppError("This shipment is on hold — resume it before recording progress", 409)); // RULE-SH-09
  assertShipmentUnlocked(shipment, "record milestones against it"); // RULE-SH-12 (covers cancelled)

  const milestones = await prisma.otcMilestone.findMany({
    where: { shipmentId: shipment.id },
    orderBy: { milestoneNo: "asc" },
  });
  const target = milestones.find((m) => m.milestoneNo === milestoneNo);
  if (!target) return next(new AppError("Milestone not found", 404));
  if (target.status === "done") return next(new AppError("Milestone already complete", 409));

  // In order (RULE-FI-04) — the previous milestone must be done first.
  const prev = milestones.find((m) => m.milestoneNo === milestoneNo - 1);
  if (prev && prev.status !== "done") {
    return next(new AppError(`Complete milestone ${milestoneNo - 1} first (RULE-FI-04)`, 409));
  }

  const newStatus = await prisma.$transaction(async (tx) => {
    await tx.otcMilestone.update({
      where: { id: target.id },
      data: { status: "done", completedById: req.user.id, completedAt: new Date() },
    });
    await auditShipment(tx, {
      actorId: req.user.id,
      action: "otc.milestone.complete",
      resourceType: "shipment",
      resourceId: shipment.id,
      diff: { milestoneNo, type: target.type, notes: req.body?.notes ?? null },
    });
    return maybeSettleTx(tx, shipment.id, req.user.id);
  });

  res.json({
    success: true,
    message: newStatus === "settled" ? `OTC milestone ${milestoneNo} completed — shipment settled` : `OTC milestone ${milestoneNo} completed`,
    data: { status: newStatus },
  });
});
