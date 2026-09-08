import express from "express";
import { getCatalog, getReference, composePreview } from "./service.controllers.js";
import { protect } from "../auth/auth.middleware.js";
import { requireServiceAccess } from "./service.middleware.js";

const router = express.Router();

router.use(protect, requireServiceAccess);

router.get("/catalog", getCatalog);
router.get("/reference", getReference);
// Composition takes no inputs now — every shipment runs the same path.
router.post("/compose", composePreview);

export default router;
