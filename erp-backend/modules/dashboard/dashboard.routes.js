import express from "express";
import { getDashboard } from "./dashboard.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireDashboardAccess } from "./dashboard.middleware.js";

const router = express.Router();

router.use(protect, requireDashboardAccess);

router.get("/", requirePermission("dashboard.read"), getDashboard);

export default router;
