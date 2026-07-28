import express from "express";
import {
  uploadDocument,
  listDocuments,
  downloadDocument,
  publishDocument,
  deleteDocument,
  requiredDocsForShipment,
} from "./document.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireDocumentAccess, uploadSingle } from "./document.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.middleware.js";
import { uploadSchema, listQuerySchema, deleteSchema } from "./document.validation.js";

/**
 * Documents (CRM_MASTER §5.13) at /api/documents. Internal by default (INV-10);
 * publish is manager-level; step-mandatory docs can't be deleted (RULE-DOC-04).
 * Upload uses multer (installed manually — 503 until then).
 */
const router = express.Router();

router.use(protect, requireDocumentAccess);

router.get("/required/:shipmentId", requirePermission("document.read"), requiredDocsForShipment);
router.get("/", requirePermission("document.read"), validateQuery(listQuerySchema), listDocuments);
router.get("/:id/download", requirePermission("document.read"), downloadDocument);

router.post("/", requirePermission("document.upload"), uploadSingle("file"), validate(uploadSchema), uploadDocument);
router.post("/:id/publish", requirePermission("document.publish"), publishDocument);
router.delete("/:id", requirePermission("document.delete"), validate(deleteSchema), deleteDocument);

export default router;
