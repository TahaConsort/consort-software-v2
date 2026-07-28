import { requireManagement } from "../auth/auth.middleware.js";

/**
 * Action Engine visibility (CRM_MASTER §5.12). The engine itself runs headless
 * in the outbox relay (jobs/outboxRelay.js); this module is a READ surface over
 * its config and dead-letters. Unroutable actions escalate to Management
 * (RULE-AE-05), so the whole surface is Management-only — the same tier that
 * owns audit (BUSINESS_RULES §2.2: audit.read = A).
 */
export const requireActionEngineAccess = requireManagement;
