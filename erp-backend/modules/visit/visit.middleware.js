import { requireRole } from "../auth/auth.middleware.js";
import { attachLeadScope } from "../lead/lead.middleware.js";

/**
 * Visit Plans access + scope (RULE-VP-03): the standard sales ladder —
 * BDO sees own plans, ASM their team's, Management all. The scope resolution
 * is identical to leads (same reporting closure), so it is reused; for visits
 * the owner field is `assignedToId`.
 */

export const requireVisitAccess = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "asm",
  "bdo",
);

// Sets req.leadScope — null (all) or { ownerIds } (ASM team / BDO own).
export const attachVisitScope = attachLeadScope;

export const visitInScope = (req, visit) =>
  !req.leadScope || req.leadScope.ownerIds.includes(visit.assignedToId);
