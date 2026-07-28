import { requireRole } from "../auth/auth.middleware.js";

/**
 * Chat access (RULE-CH-01, INV-11): every INTERNAL role participates; customers
 * are never members, so the customer role is excluded here — the guard is what
 * enforces "customers are never members of internal chat channels".
 */
export const requireChatAccess = requireRole(
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
);
