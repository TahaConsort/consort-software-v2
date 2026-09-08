import express from "express";
import {
  listShipments,
  getShipment,
  holdShipment,
  resumeShipment,
  cancelShipment,
  closeShipment,
  setSchedule,
  getShipmentPnl,
  listShipmentParties,
  addShipmentParty,
  updateShipmentParty,
  removeShipmentParty,
  createTradeShipment,
} from "./shipment.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireShipmentAccess, attachShipmentScope } from "./shipment.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  holdSchema,
  resumeSchema,
  cancelSchema,
  scheduleSchema,
  addPartySchema,
  updatePartySchema,
} from "./shipment.validation.js";
import { createTradeShipmentSchema } from "../trade/trade.validation.js";

/**
 * Shipment (CRM_MASTER §5.8). Reads + the exception lifecycle. OTD step
 * progression is served by the OTD module (/api/otd, §5.9); OTC milestones by
 * the OTC module (/api/otc, §5.10).
 */
const router = express.Router();

router.use(protect, requireShipmentAccess, attachShipmentScope);

router.get("/", requirePermission("shipment.read"), listShipments);
router.get("/:id", requirePermission("shipment.read"), getShipment);

// Job P&L — quoted vs invoiced revenue/cost/margin + open payables. Margin is
// reporting, not step work, so it is gated on `report.read` rather than shipment
// access: department executives see the job, not what the company makes on it.
router.get("/:id/pnl", requirePermission("report.read"), getShipmentPnl);

// Schedule (ETD/ETA) — enables the ETA-breach sweep (WORKFLOW §14).
router.patch("/:id/schedule", requirePermission("shipment.schedule"), validate(scheduleSchema), setSchedule);

// Exceptions — orthogonal to progress (RULE-SH-08).
router.post("/:id/hold", requirePermission("shipment.hold"), validate(holdSchema), holdShipment);
router.post("/:id/resume", requirePermission("shipment.resume"), validate(resumeSchema), resumeShipment);
router.post("/:id/cancel", requirePermission("shipment.cancel"), validate(cancelSchema), cancelShipment);
router.post("/:id/close", requirePermission("shipment.close"), closeShipment);

// Trade shipment origination (Export Shipment Workflow roadmap Step 1). A trade
// shipment is born from a Trade Contract plus a Financial Instrument rather than from an
// approved quotation, which is why INV-03 needed superseding (ADR-053). Static path,
// declared BEFORE /:id so "trade" is never read as a shipment id.
router.post("/trade", requirePermission("trade.contract.manage"), validate(createTradeShipmentSchema), createTradeShipment);

// Parties — who plays which role ON THIS SHIPMENT (Export Shipment Workflow roadmap
// §2/§7). Reads ride `trade.read`, so every department that can see the shipment can see
// its counterparties; writes need `trade.party.manage` (Operations + Compliance). A
// portal customer holds only `trade.read`, so the router 403s them off every write, and
// the read additionally strips bank and tax fields (utils/partyRoles.js).
router.get("/:id/parties", requirePermission("trade.read"), listShipmentParties);
router.post("/:id/parties", requirePermission("trade.party.manage"), validate(addPartySchema), addShipmentParty);
router.patch("/:id/parties/:partyId", requirePermission("trade.party.manage"), validate(updatePartySchema), updateShipmentParty);
router.delete("/:id/parties/:partyId", requirePermission("trade.party.manage"), removeShipmentParty);

export default router;
