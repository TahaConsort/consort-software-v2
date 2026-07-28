import express from "express";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { createChargeSchema, confirmChargeSchema, cancelChargeSchema } from "./charge.validation.js";
import { listChargeTypes, listCharges, createCharge, confirmCharge, cancelCharge } from "./charge.controllers.js";

/**
 * Job-charge ledger (freight-forwarding OTC upgrade). Read: `charge.read`.
 * Create: `charge.create`; confirm/cancel: `charge.confirm`.
 */
const router = express.Router();

router.use(protect);

router.get("/types", requirePermission("charge.read"), listChargeTypes);
router.get("/", requirePermission("charge.read"), listCharges);
router.post("/", requirePermission("charge.create"), validate(createChargeSchema), createCharge);
router.patch("/:id/confirm", requirePermission("charge.confirm"), validate(confirmChargeSchema), confirmCharge);
router.patch("/:id/cancel", requirePermission("charge.confirm"), validate(cancelChargeSchema), cancelCharge);

export default router;
