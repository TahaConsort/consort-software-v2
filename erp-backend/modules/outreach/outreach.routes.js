import express from "express";
import { listOutreach, createOutreach, followUpsDue } from "./outreach.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireOutreachAccess, attachOutreachScope } from "./outreach.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { createOutreachSchema } from "./outreach.validation.js";

const router = express.Router();

router.use(protect, requireOutreachAccess, attachOutreachScope);

// Static route before any future "/:id".
router.get("/follow-ups-due", requirePermission("lead.read"), followUpsDue);

router.get("/", requirePermission("lead.read"), listOutreach);
router.post("/", requirePermission("lead.update"), validate(createOutreachSchema), createOutreach);

export default router;
