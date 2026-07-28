import express from "express";
import { listQueries, createQuery, getQuery, updateQuery, cancelQuery } from "./query.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireQueryAccess, attachQueryScope } from "./query.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { createQuerySchema, updateQuerySchema, cancelQuerySchema } from "./query.validation.js";

const router = express.Router();

router.use(protect, requireQueryAccess, attachQueryScope);

router.get("/", requirePermission("query.read"), listQueries);
// query.create is held by ASM/BDO/customer — Management is read-only here
// (BUSINESS_RULES §2.2: "A (read)").
router.post("/", requirePermission("query.create"), validate(createQuerySchema), createQuery);

router.get("/:id", requirePermission("query.read"), getQuery);
router.put("/:id", requirePermission("query.update"), validate(updateQuerySchema), updateQuery);
router.post("/:id/cancel", requirePermission("query.cancel"), validate(cancelQuerySchema), cancelQuery);

export default router;
