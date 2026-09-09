import express from "express";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { createVendorSchema, updateVendorSchema, vendorQuoteRequestSchema } from "./vendor.validation.js";
import { listVendors, getVendor, createVendor, updateVendor, deactivateVendor, deleteVendor, requestVendorQuote } from "./vendor.controllers.js";

/**
 * Vendor master (freight-forwarding OTC upgrade). Read: `vendor.read`.
 * Writes: `vendor.manage` (ops_manager, transport_manager, accounts + Management).
 */
const router = express.Router();

router.use(protect);

router.get("/", requirePermission("vendor.read"), listVendors);
router.get("/:id", requirePermission("vendor.read"), getVendor);
router.post("/", requirePermission("vendor.manage"), validate(createVendorSchema), createVendor);
router.patch("/:id", requirePermission("vendor.manage"), validate(updateVendorSchema), updateVendor);
// Emailing a vendor for rates is a buy-side action, so it rides on rfq.manage rather
// than vendor.manage — asking for a price is not editing the directory.
router.post("/:id/quote-request", requirePermission("rfq.manage"), validate(vendorQuoteRequestSchema), requestVendorQuote);
router.post("/:id/deactivate", requirePermission("vendor.manage"), deactivateVendor);
router.delete("/:id", requirePermission("vendor.manage"), deleteVendor);

export default router;
