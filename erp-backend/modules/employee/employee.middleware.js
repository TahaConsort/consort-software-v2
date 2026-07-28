import { requireRole } from "../auth/auth.middleware.js";

/**
 * Employee Management access gate (RULE-EMP-01).
 * Only the admin/management sector — the five Management roles plus HR — may
 * create, edit or deactivate employees. Applied after `protect`; finer
 * per-action checks use `requirePermission` from the auth module.
 */
export const requireEmployeeAdmin = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "hr",
);
