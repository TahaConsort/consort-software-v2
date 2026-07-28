import express from "express";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { createVendorSchema, updateVendorSchema } from "./vendor.validation.js";
import { listVendors, getVendor, createVendor, updateVendor, deactivateVendor } from "./vendor.controllers.js";

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
router.post("/:id/deactivate", requirePermission("vendor.manage"), deactivateVendor);

export default router;
