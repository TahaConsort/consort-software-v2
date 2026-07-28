import prisma from "../../config/prisma.js";
import { requireRole } from "../auth/auth.middleware.js";
import { attachLeadScope } from "../lead/lead.middleware.js";

/**
 * Outreach access + scope — the sales ladder (BUSINESS_RULES §2.2, lead.*):
 * BDO own, ASM team, Management all. Reuses the lead scope resolution;
 * a row is in scope when its actor, its lead's owner, or its customer's
 * assigned BDO falls inside the resolved user set.
 */

export const requireOutreachAccess = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "asm",
  "bdo",
);

// Sets req.leadScope — null (all) or { ownerIds } (ASM team / BDO own).
export const attachOutreachScope = attachLeadScope;

/** Prisma where-fragment restricting outreach rows to the request's scope. */
export const scopedOutreachWhere = async (req, extra = {}) => {
  const scope = req.leadScope;
  if (!scope) return extra;

  const [leads, customers] = await Promise.all([
    prisma.lead.findMany({
      where: { ownerId: { in: scope.ownerIds } },
      select: { id: true },
    }),
    prisma.customer.findMany({
      where: { assignedBdoId: { in: scope.ownerIds } },
      select: { id: true },
    }),
  ]);

  return {
    ...extra,
    OR: [
      { actorId: { in: scope.ownerIds } },
      { leadId: { in: leads.map((l) => l.id) } },
      { customerId: { in: customers.map((c) => c.id) } },
    ],
  };
};
