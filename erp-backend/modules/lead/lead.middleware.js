import prisma from "../../config/prisma.js";
import { requireRole, isManagement, hasRole } from "../auth/auth.middleware.js";

/**
 * Lead Management access + row-level scope (BUSINESS_RULES §2.2/2.3).
 *
 * lead.* is held by: Management (scope A), ASM (scope T — reporting closure),
 * BDO (scope O — own rows). Scope is applied here in the data layer, not
 * remembered by controllers; out-of-scope reads must 404, never 403.
 */

export const requireLeadAccess = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "asm",
  "bdo",
);

/**
 * Resolve the ASM's team closure: every employee whose reporting chain leads
 * to the ASM (WORKFLOW §14 warms this via cache in the target design; a
 * direct walk is correct and fine at Phase-1 data sizes).
 */
export const teamUserIds = async (asmUser) => {
  const ids = new Set([asmUser.id]);
  if (!asmUser.employeeId) return [...ids];

  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true, managerId: true, user: { select: { id: true } } },
  });

  const childrenOf = new Map();
  for (const e of employees) {
    if (!e.managerId) continue;
    if (!childrenOf.has(e.managerId)) childrenOf.set(e.managerId, []);
    childrenOf.get(e.managerId).push(e);
  }

  const queue = [asmUser.employeeId];
  while (queue.length) {
    const current = queue.shift();
    for (const child of childrenOf.get(current) ?? []) {
      if (child.user?.id) ids.add(child.user.id);
      queue.push(child.id);
    }
  }
  return [...ids];
};

/**
 * Attaches `req.leadScope`:
 *   null                → unrestricted (Management)
 *   { ownerIds: [...] } → restrict to these owners (ASM team / BDO own)
 */
export const attachLeadScope = async (req, res, next) => {
  try {
    if (isManagement(req.user)) {
      req.leadScope = null;
    } else if (hasRole(req.user, "asm")) {
      req.leadScope = { ownerIds: await teamUserIds(req.user) };
    } else {
      req.leadScope = { ownerIds: [req.user.id] }; // bdo — own rows only
    }
    next();
  } catch (err) {
    next(err);
  }
};

/** True when the given lead is visible under the request's scope. */
export const inScope = (req, lead) =>
  !req.leadScope || req.leadScope.ownerIds.includes(lead.ownerId);
