import { requireRole, isManagement, hasRole } from "../auth/auth.middleware.js";
import { teamUserIds } from "../lead/lead.middleware.js";
import prisma from "../../config/prisma.js";

/**
 * Query access + scope (BUSINESS_RULES §2.2/2.3):
 *   Management         read (A)          Ops / Compliance   read (D)
 *   ASM                team (T)          BDO                own (O)
 *   Customer (portal)  own customer (C)
 *
 * Scope resolves to req.queryScope:
 *   null                       → unrestricted read
 *   { ownerIds }               → raised-by or assigned-BDO within these users
 *   { customerId }             → portal user's own customer only
 */

export const requireQueryAccess = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "asm",
  "bdo",
  "ops_manager",
  "ops_exec",
  "compliance_manager",
  "compliance_exec",
  "customer",
);

const DEPARTMENT_READ_ROLES = ["ops_manager", "ops_exec", "compliance_manager", "compliance_exec"];

export const attachQueryScope = async (req, res, next) => {
  try {
    if (isManagement(req.user) || hasRole(req.user, ...DEPARTMENT_READ_ROLES)) {
      req.queryScope = null;
    } else if (req.user.role === "customer") {
      req.queryScope = { customerId: req.user.customerId };
    } else if (hasRole(req.user, "asm")) {
      req.queryScope = { ownerIds: await teamUserIds(req.user) };
    } else {
      req.queryScope = { ownerIds: [req.user.id] }; // bdo
    }
    next();
  } catch (err) {
    next(err);
  }
};

/** Prisma where-fragment for the current scope. */
export const scopedQueryWhere = async (req, extra = {}) => {
  const scope = req.queryScope;
  if (!scope) return extra;
  if (scope.customerId) return { ...extra, customerId: scope.customerId };

  // Sales scope: raised by someone in scope, OR belonging to a customer
  // assigned to someone in scope.
  const customers = await prisma.customer.findMany({
    where: { assignedBdoId: { in: scope.ownerIds } },
    select: { id: true },
  });
  return {
    ...extra,
    OR: [
      { raisedById: { in: scope.ownerIds } },
      { customerId: { in: customers.map((c) => c.id) } },
    ],
  };
};

export const queryInScope = async (req, query) => {
  const scope = req.queryScope;
  if (!scope) return true;
  if (scope.customerId) return query.customerId === scope.customerId;
  if (scope.ownerIds.includes(query.raisedById)) return true;
  const customer = await prisma.customer.findUnique({ where: { id: query.customerId } });
  return !!customer && scope.ownerIds.includes(customer.assignedBdoId);
};
