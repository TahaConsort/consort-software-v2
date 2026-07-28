import express from "express";
import { getCatalog, getPackages, getReference, composePreview } from "./service.controllers.js";
import { protect } from "../auth/auth.middleware.js";
import { requireServiceAccess } from "./service.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { composeSchema } from "./service.validation.js";

const router = express.Router();

router.use(protect, requireServiceAccess);

router.get("/catalog", getCatalog);
router.get("/packages", getPackages);
router.get("/reference", getReference);
router.post("/compose", validate(composeSchema), composePreview);

export default router;
