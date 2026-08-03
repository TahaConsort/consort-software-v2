import express from "express";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { updateLcStatusSchema, rejectLcSchema, convertLcSchema } from "./lc.validation.js";
import {
  receiveWebhook,
  listReferrals,
  getReferral,
  updateReferralStatus,
  rejectReferral,
  convertReferral,
  extractReferral,
  applyExtraction,
} from "./lc.controllers.js";

/**
 * Bank LC intake (CRM_MASTER §5.21).
 *   · webhookRouter — PUBLIC (shared-secret authed in the controller), mounted
 *     at /api/webhooks. Idempotent inbound LC posting.
 *   · inboxRouter — INTERNAL, mounted at /api/lc-referrals. `lc.read` to view,
 *     `lc.convert` to materialise a customer + query.
 */

export const webhookRouter = express.Router();
webhookRouter.post("/bank/lc", receiveWebhook);

const inboxRouter = express.Router();
inboxRouter.use(protect);
inboxRouter.get("/", requirePermission("lc.read"), listReferrals);
inboxRouter.get("/:id", requirePermission("lc.read"), getReferral);
inboxRouter.get("/:id/extract", requirePermission("lc.read"), extractReferral); // read the attached PDF
inboxRouter.post("/:id/extract/apply", requirePermission("lc.convert"), applyExtraction);
inboxRouter.patch("/:id/status", requirePermission("lc.read"), validate(updateLcStatusSchema), updateReferralStatus);
inboxRouter.post("/:id/reject", requirePermission("lc.convert"), validate(rejectLcSchema), rejectReferral);
inboxRouter.post("/:id/convert", requirePermission("lc.convert"), validate(convertLcSchema), convertReferral);

export default inboxRouter;
