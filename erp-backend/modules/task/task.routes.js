import express from "express";
import { listTasks, getTask, claimTask, reassignTask, completeTask } from "./task.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireTaskAccess, attachTaskScope } from "./task.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { completeTaskSchema, reassignTaskSchema } from "./task.validation.js";

const router = express.Router();

router.use(protect, requireTaskAccess, attachTaskScope);

router.get("/", requirePermission("task.read"), listTasks);
router.get("/:id", requirePermission("task.read"), getTask);
router.post("/:id/claim", requirePermission("task.update"), claimTask);
router.post("/:id/complete", requirePermission("task.complete"), validate(completeTaskSchema), completeTask);
router.post("/:id/reassign", requirePermission("task.reassign"), validate(reassignTaskSchema), reassignTask);

export default router;
