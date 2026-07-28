import express from "express";
import {
  leadsReport,
  shipmentsReport,
  revenueReport,
  tasksReport,
  outreachReport,
  unservedDemandReport,
} from "./report.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireReportAccess, attachReportScope, requireRevenueAccess } from "./report.middleware.js";
import { validateQuery } from "../../middleware/validate.middleware.js";
import { reportQuerySchema } from "./report.validation.js";

/**
 * Reports (CRM_MASTER §5.18) at /api/reports. Role-gated (report.read) and
 * row-scoped by the live role (§5.17); revenue is Finance/Management only.
 */
const router = express.Router();

router.use(protect, requireReportAccess, requirePermission("report.read"), attachReportScope, validateQuery(reportQuerySchema));

router.get("/leads", leadsReport);
router.get("/shipments", shipmentsReport);
router.get("/revenue", requireRevenueAccess, revenueReport);
router.get("/tasks", tasksReport);
router.get("/outreach", outreachReport);
router.get("/unserved-demand", unservedDemandReport);

export default router;
