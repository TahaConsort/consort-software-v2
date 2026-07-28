import { requireManagement } from "../auth/auth.middleware.js";

/**
 * Audit access (CRM_MASTER §5.19, BUSINESS_RULES §2.2 — audit.read = A).
 * The audit trail is Management-only; no other role may read it.
 */
export const requireAuditAccess = requireManagement;
