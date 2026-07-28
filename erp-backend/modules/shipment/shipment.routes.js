import express from "express";
import {
  listShipments,
  getShipment,
  holdShipment,
  resumeShipment,
  cancelShipment,
  closeShipment,
  setSchedule,
} from "./shipment.controllers.js";
import { getShipmentPnl } from "../charge/charge.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireShipmentAccess, attachShipmentScope } from "./shipment.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { holdSchema, resumeSchema, cancelSchema, scheduleSchema } from "./shipment.validation.js";

/**
 * Shipment (CRM_MASTER §5.8). Reads + the exception lifecycle. OTD step
 * progression is served by the OTD module (/api/otd, §5.9); OTC milestones by
 * the OTC module (/api/otc, §5.10).
 */
const router = express.Router();

router.use(protect, requireShipmentAccess, attachShipmentScope);

router.get("/", requirePermission("shipment.read"), listShipments);
router.get("/:id", requirePermission("shipment.read"), getShipment);

// Job P&L — estimated vs actual revenue/cost/margin + open payables (charge ledger).
router.get("/:id/pnl", requirePermission("charge.read"), getShipmentPnl);

// Schedule (ETD/ETA) — enables the ETA-breach sweep (WORKFLOW §14).
router.patch("/:id/schedule", requirePermission("shipment.schedule"), validate(scheduleSchema), setSchedule);

// Exceptions — orthogonal to progress (RULE-SH-08).
router.post("/:id/hold", requirePermission("shipment.hold"), validate(holdSchema), holdShipment);
router.post("/:id/resume", requirePermission("shipment.resume"), validate(resumeSchema), resumeShipment);
router.post("/:id/cancel", requirePermission("shipment.cancel"), validate(cancelSchema), cancelShipment);
router.post("/:id/close", requirePermission("shipment.close"), closeShipment);

export default router;
