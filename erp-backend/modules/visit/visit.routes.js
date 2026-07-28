import express from "express";
import {
  listVisits,
  createVisit,
  completeVisit,
  noShowVisit,
  cancelVisit,
  rescheduleVisit,
} from "./visit.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireVisitAccess, attachVisitScope } from "./visit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  createVisitSchema,
  completeVisitSchema,
  cancelVisitSchema,
  rescheduleVisitSchema,
} from "./visit.validation.js";

const router = express.Router();

router.use(protect, requireVisitAccess, attachVisitScope);

router.get("/", requirePermission("visit.read"), listVisits);
router.post("/", requirePermission("visit.create"), validate(createVisitSchema), createVisit);

router.post("/:id/complete", requirePermission("visit.complete"), validate(completeVisitSchema), completeVisit);
router.post("/:id/no-show", requirePermission("visit.update"), noShowVisit);
router.post("/:id/cancel", requirePermission("visit.update"), validate(cancelVisitSchema), cancelVisit);
router.post("/:id/reschedule", requirePermission("visit.update"), validate(rescheduleVisitSchema), rescheduleVisit);

export default router;
