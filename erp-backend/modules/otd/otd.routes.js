import express from "express";
import { listSteps, updateStepDetails, completeStep, reopenStep, setStepAction } from "./otd.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireOtdAccess, attachShipmentScope } from "./otd.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { completeStepSchema, reopenStepSchema, updateStepDetailsSchema, setStepActionSchema } from "./otd.validation.js";

/**
 * OTD — Order to Delivery (CRM_MASTER §5.9). The service-composed step engine
 * mounted at /api/otd; completion is department-scoped (RULE-SH-04), reopen is
 * manager-level (RULE-SH-05). Status is derived, never written (ADR-014).
 */
const router = express.Router();

router.use(protect, requireOtdAccess, attachShipmentScope);

router.get("/:shipmentId/steps", requirePermission("shipment.read"), listSteps);
router.patch(
  "/:shipmentId/steps/:displayNo/details",
  requirePermission("shipment.step.complete"),
  validate(updateStepDetailsSchema),
  updateStepDetails,
);
// A sub-action is part of doing the step, so it takes the same permission as
// completing one — ownership is then narrowed to the step's department (RULE-SH-04).
router.patch(
  "/:shipmentId/steps/:displayNo/actions/:actionCode",
  requirePermission("shipment.step.complete"),
  validate(setStepActionSchema),
  setStepAction,
);
router.patch(
  "/:shipmentId/steps/:displayNo/complete",
  requirePermission("shipment.step.complete"),
  validate(completeStepSchema),
  completeStep,
);
router.patch(
  "/:shipmentId/steps/:displayNo/reopen",
  requirePermission("shipment.step.reopen"),
  validate(reopenStepSchema),
  reopenStep,
);

export default router;
