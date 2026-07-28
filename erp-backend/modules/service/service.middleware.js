import { requireRole } from "../auth/auth.middleware.js";

/**
 * Service catalog is reference data — readable by any internal role and by
 * portal customers (they pick services when self-serving a query, §5.6).
 */
export const requireServiceAccess = requireRole(
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
