import express from "express";
import {
  listQuotations,
  getQuotation,
  createQuotation,
  updateQuotation,
  sendQuotation,
  approveQuotation,
  rejectQuotation,
  reviseQuotation,
} from "./quotation.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireQuotationAccess, attachQuotationScope } from "./quotation.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  createQuotationSchema,
  updateQuotationSchema,
  approveQuotationSchema,
  rejectQuotationSchema,
} from "./quotation.validation.js";

const router = express.Router();

router.use(protect, requireQuotationAccess, attachQuotationScope);

router.get("/", requirePermission("quotation.read"), listQuotations);
router.get("/:id", requirePermission("quotation.read"), getQuotation);

// Ops drafts / edits / revises; only ops_manager sends (four-eyes, RULE-QT-01).
router.post("/", requirePermission("quotation.create"), validate(createQuotationSchema), createQuotation);
router.put("/:id", requirePermission("quotation.revise"), validate(updateQuotationSchema), updateQuotation);
router.post("/:id/send", requirePermission("quotation.send"), sendQuotation);
router.post("/:id/revise", requirePermission("quotation.revise"), reviseQuotation);

// Decision — customer / ASM / Management, never the owning BDO (RULE-QT-03).
router.post("/:id/approve", requirePermission("quotation.approve"), validate(approveQuotationSchema), approveQuotation);
router.post("/:id/reject", requirePermission("quotation.reject"), validate(rejectQuotationSchema), rejectQuotation);

export default router;
