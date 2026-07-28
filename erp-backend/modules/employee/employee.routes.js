import express from "express";
import {
  listDepartments,
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  getOpenWork,
  reassignWork,
  deactivateEmployee,
} from "./employee.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireEmployeeAdmin } from "./employee.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  reassignWorkSchema,
} from "./employee.validation.js";

const router = express.Router();

// Every route: authenticated + admin/management sector (RULE-EMP-01).
router.use(protect, requireEmployeeAdmin);

// Static route before param routes so it isn't swallowed by "/:id".
router.get("/departments", requirePermission("employee.read"), listDepartments);

router.get("/", requirePermission("employee.read"), listEmployees);
router.post("/", requirePermission("employee.create"), validate(createEmployeeSchema), createEmployee);

router.get("/:id", requirePermission("employee.read"), getEmployee);
router.put("/:id", requirePermission("employee.update"), validate(updateEmployeeSchema), updateEmployee);

router.get("/:id/open-work", requirePermission("employee.deactivate"), getOpenWork);
router.post("/:id/reassign-work", requirePermission("employee.reassign"), validate(reassignWorkSchema), reassignWork);
router.delete("/:id", requirePermission("employee.deactivate"), deactivateEmployee);

export default router;
