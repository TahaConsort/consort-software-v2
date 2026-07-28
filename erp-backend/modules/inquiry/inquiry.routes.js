import express from "express";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { updateInquiryStatusSchema, convertInquirySchema } from "./inquiry.validation.js";
import { listInquiries, getInquiry, updateInquiryStatus, convertInquiry } from "./inquiry.controllers.js";

/**
 * Public Inquiry triage (CRM_MASTER §5.20). Sales-facing: `inquiry.read` to
 * view/triage, `inquiry.convert` to materialise a customer + query.
 */
const router = express.Router();

router.use(protect);

router.get("/", requirePermission("inquiry.read"), listInquiries);
router.get("/:id", requirePermission("inquiry.read"), getInquiry);
router.patch("/:id/status", requirePermission("inquiry.read"), validate(updateInquiryStatusSchema), updateInquiryStatus);
router.post("/:id/convert", requirePermission("inquiry.convert"), validate(convertInquirySchema), convertInquiry);

export default router;
