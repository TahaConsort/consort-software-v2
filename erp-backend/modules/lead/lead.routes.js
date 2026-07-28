import express from "express";
import {
  listLeads,
  createLead,
  getLead,
  updateLead,
  logOutreach,
  transitionLead,
  reopenLead,
  convertLead,
} from "./lead.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireLeadAccess, attachLeadScope } from "./lead.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  createLeadSchema,
  updateLeadSchema,
  transitionSchema,
  reopenSchema,
  outreachSchema,
} from "./lead.validation.js";

const router = express.Router();

// Authenticated → sales sector → row-level scope resolved once per request.
router.use(protect, requireLeadAccess, attachLeadScope);

router.get("/", requirePermission("lead.read"), listLeads);
router.post("/", requirePermission("lead.create"), validate(createLeadSchema), createLead);

router.get("/:id", requirePermission("lead.read"), getLead);
router.put("/:id", requirePermission("lead.update"), validate(updateLeadSchema), updateLead);

router.post("/:id/outreach", requirePermission("lead.update"), validate(outreachSchema), logOutreach);
router.post("/:id/status", requirePermission("lead.update"), validate(transitionSchema), transitionLead);
router.post("/:id/reopen", requirePermission("lead.reopen"), validate(reopenSchema), reopenLead);
router.post("/:id/convert", requirePermission("lead.convert"), convertLead);

export default router;
