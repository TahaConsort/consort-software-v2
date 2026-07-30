import express from "express";
import { protect, requireManagement, requirePermission } from "../auth/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  createStepSchema,
  updateStepSchema,
  replaceActionsSchema,
  createDocTypeSchema,
  updateDocTypeSchema,
} from "./workflow.validation.js";
import {
  getMeta,
  listSteps,
  createStep,
  updateStep,
  deleteStep,
  replaceActions,
  listDocTypes,
  createDocType,
  updateDocType,
  deleteDocType,
  validateCatalog,
} from "./workflow.controllers.js";

/**
 * Workflow catalog admin (ADR-051) at /api/workflow.
 *
 * One gate for the WHOLE router, reads included: this is the admin panel over the
 * composition source of truth, not a data API — the same precedent as /api/audit and
 * /api/action-engine (Management-only surfaces).
 */
const router = express.Router();

router.use(protect, requireManagement, requirePermission("workflow.manage"));

router.get("/meta", getMeta);
router.get("/validate", validateCatalog);

router.get("/steps", listSteps);
router.post("/steps", validate(createStepSchema), createStep);
router.patch("/steps/:stepCode", validate(updateStepSchema), updateStep);
router.delete("/steps/:stepCode", deleteStep);
router.put("/steps/:stepCode/actions", validate(replaceActionsSchema), replaceActions);

router.get("/doc-types", listDocTypes);
router.post("/doc-types", validate(createDocTypeSchema), createDocType);
router.patch("/doc-types/:code", validate(updateDocTypeSchema), updateDocType);
router.delete("/doc-types/:code", deleteDocType);

export default router;
