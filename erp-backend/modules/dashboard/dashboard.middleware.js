import { requireRole } from "../auth/auth.middleware.js";

/** Dashboard is role-aware (§5.17) — every authenticated role has one. */
export const requireDashboardAccess = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "hr",
  "asm",
  "bdo",
  "ops_manager",
  "ops_exec",
  "compliance_manager",
  "compliance_exec",
  "transport_manager",
  "transport_exec",
  "accounts",
  "customer",
);
