import express from "express";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { createPostingSchema, updatePostingSchema } from "./loadboard.validation.js";
import { listPostings, createPosting, updatePosting, deactivatePosting } from "./loadboard.controllers.js";

/**
 * Internal load board management (CRM_MASTER §5.20). Requires `loadboard.manage`
 * (ops_manager, transport_manager + Management). Public read is in the storefront.
 */
const router = express.Router();

router.use(protect, requirePermission("loadboard.manage"));

router.get("/", listPostings);
router.post("/", validate(createPostingSchema), createPosting);
router.patch("/:id", validate(updatePostingSchema), updatePosting);
router.delete("/:id", deactivatePosting);

export default router;
