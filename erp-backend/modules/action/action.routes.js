import express from "express";
import { listTemplates, listOutbox, listUnroutable } from "./action.controllers.js";
import { protect } from "../auth/auth.middleware.js";
import { requireActionEngineAccess } from "./action.middleware.js";
import { validateQuery } from "../../middleware/validate.middleware.js";
import { outboxQuerySchema } from "./action.validation.js";

/**
 * Action Engine (CRM_MASTER §5.12) at /api/action-engine — Management-only read
 * surface over templates, the outbox event flow, and unroutable escalations.
 */
const router = express.Router();

router.use(protect, requireActionEngineAccess);

router.get("/templates", listTemplates);
router.get("/outbox", validateQuery(outboxQuerySchema), listOutbox);
router.get("/unroutable", listUnroutable);

export default router;
