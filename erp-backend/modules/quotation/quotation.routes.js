import express from "express";
import {
  listQuotations,
  getQuotation,
  createQuotation,
  updateQuotation,
  sendQuotation,
  shareQuotation,
  approveQuotation,
  rejectQuotation,
  reviseQuotation,
  listChargeTypes,
} from "./quotation.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireQuotationAccess, attachQuotationScope } from "./quotation.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  createQuotationSchema,
  updateQuotationSchema,
  approveQuotationSchema,
  rejectQuotationSchema,
  shareQuotationSchema,
} from "./quotation.validation.js";
import {
  issueApprovalLink,
  getApprovalLink,
  revokeApprovalLink,
  recordAcceptance,
} from "../approval/approval.controllers.js";
import { issueLinkSchema, acceptanceSchema } from "../approval/approval.validation.js";

const router = express.Router();

router.use(protect, requireQuotationAccess, attachQuotationScope);

router.get("/", requirePermission("quotation.read"), listQuotations);
// The seeded charge-code catalog the quote builder prices against. Declared
// before `/:id` or the param route swallows it.
router.get("/charge-types", requirePermission("quotation.read"), listChargeTypes);
router.get("/:id", requirePermission("quotation.read"), getQuotation);

// Ops drafts / edits / revises / sends. Any ops role sends since the single ops
// permission set (2026-09-08); four-eyes on pricing now sits at approval, where a
// different role decides.
router.post("/", requirePermission("quotation.create"), validate(createQuotationSchema), createQuotation);
router.put("/:id", requirePermission("quotation.revise"), validate(updateQuotationSchema), updateQuotation);
router.post("/:id/send", requirePermission("quotation.send"), sendQuotation);
// BDO relays the sent quote to the customer (mail/phone/WhatsApp) and records how —
// works for customers from the storefront form, a bank LC, or the BDO's own book.
router.post("/:id/share", requirePermission("quotation.share"), validate(shareQuotationSchema), shareQuotation);
router.post("/:id/revise", requirePermission("quotation.revise"), reviseQuotation);

// Decision. `quotation.approve` is held by the portal customer ONLY (ADR-056) — the
// click is the customer's own act. Internal users reject on the customer's behalf
// (it costs Ops nothing and routes to a revision) but never approve.
router.post("/:id/approve", requirePermission("quotation.approve"), validate(approveQuotationSchema), approveQuotation);
router.post("/:id/reject", requirePermission("quotation.reject"), validate(rejectQuotationSchema), rejectQuotation);

// Sales records the customer's verbal yes and gets a link to relay in one call
// (ADR-056). Informational — the shipment waits for the customer to confirm.
router.post("/:id/acceptance", requirePermission("quotation.share"), validate(acceptanceSchema), recordAcceptance);

// One-time customer approval link (ADR-055) — the customer decides for
// themselves instead of an internal user deciding on their behalf. Gated on
// `quotation.share`: issuing a link IS relaying the quote to the customer, and it
// deliberately does NOT require `quotation.approve` — the holder never approves,
// they only hand the decision over.
router.post("/:id/approval-link", requirePermission("quotation.share"), validate(issueLinkSchema), issueApprovalLink);
router.get("/:id/approval-link", requirePermission("quotation.read"), getApprovalLink);
router.delete("/:id/approval-link", requirePermission("quotation.share"), revokeApprovalLink);

export default router;
