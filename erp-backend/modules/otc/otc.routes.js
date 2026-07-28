import express from "express";
import { listMilestones, completeMilestone } from "./otc.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireOtcAccess, attachShipmentScope } from "./otc.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { completeMilestoneSchema } from "./otc.validation.js";

/**
 * OTC — Order to Cash (CRM_MASTER §5.10) mounted at /api/otc. Read is gated by
 * shipment scope (requireOtcAccess + row scope); recording a manual milestone
 * requires `otc.update` (Accounts / Management, RULE-FI-04). Milestones 1–2 are
 * completed automatically by the Finance module.
 */
const router = express.Router();

router.use(protect, requireOtcAccess, attachShipmentScope);

router.get("/:shipmentId/milestones", requirePermission("shipment.read"), listMilestones);
router.post(
  "/:shipmentId/milestones/:milestoneNo/complete",
  requirePermission("otc.update"),
  validate(completeMilestoneSchema),
  completeMilestone,
);

export default router;
