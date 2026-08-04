import express from "express";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { requireRfqAccess } from "./rfq.middleware.js";
import {
  createRfqBatchSchema,
  addVendorsSchema,
  enterQuoteSchema,
  cancelRfqSchema,
} from "./rfq.validation.js";
import {
  listRfqs,
  getRfq,
  getCostSheet,
  createRfqs,
  addVendors,
  enterQuote,
  declineQuote,
  selectQuote,
  cancelRfq,
  generateVendorRc,
} from "./rfq.controllers.js";

/**
 * Vendor RFQ (buy side). Read: `rfq.read`. Write: `rfq.manage`.
 * Picking the winning vendor is its own permission (`rfq.award`) so the award
 * can later be pulled back to ops_manager without touching anything else.
 */
const router = express.Router();

router.use(protect, requireRfqAccess);

// Static paths before /:id, or "cost-sheet" is read as an RFQ id.
router.get("/", requirePermission("rfq.read"), listRfqs);
router.get("/cost-sheet", requirePermission("rfq.read"), getCostSheet);
router.get("/:id", requirePermission("rfq.read"), getRfq);

router.post("/", requirePermission("rfq.manage"), validate(createRfqBatchSchema), createRfqs);
router.post("/:id/vendors", requirePermission("rfq.manage"), validate(addVendorsSchema), addVendors);
router.post("/:id/cancel", requirePermission("rfq.manage"), validate(cancelRfqSchema), cancelRfq);

router.put("/:id/quotes/:quoteId", requirePermission("rfq.manage"), validate(enterQuoteSchema), enterQuote);
router.post("/:id/quotes/:quoteId/decline", requirePermission("rfq.manage"), declineQuote);
router.post("/:id/quotes/:quoteId/select", requirePermission("rfq.award"), selectQuote);
router.post("/:id/quotes/:quoteId/rc", requirePermission("rfq.manage"), generateVendorRc);

export default router;
