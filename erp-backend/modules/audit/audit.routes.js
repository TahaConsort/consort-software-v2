import express from "express";
import { listAudit, resourceHistory, auditFacets } from "./audit.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireAuditAccess } from "./audit.middleware.js";
import { validateQuery } from "../../middleware/validate.middleware.js";
import { auditQuerySchema } from "./audit.validation.js";

/**
 * Audit (CRM_MASTER §5.19) at /api/audit — Management-only (audit.read = A).
 */
const router = express.Router();

router.use(protect, requireAuditAccess, requirePermission("audit.read"));

router.get("/", validateQuery(auditQuerySchema), listAudit);
router.get("/facets", auditFacets);
router.get("/resource/:resourceType/:resourceId", resourceHistory);

export default router;
