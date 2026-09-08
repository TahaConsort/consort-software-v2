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
 *   { ownerIds }               → raised-by or assigned-BDO within these users,
 *                                PLUS the unclaimed pool (see below)
 *   { website }                → the website channel: raisedVia = portal
 *                                (web_manager; composes with ownerIds for a
 *                                multi-role user)
 *   { customerId }             → portal user's own customer only
 *
 * The unclaimed pool: a storefront self-signup lands with `assignedBdoId = null`
 * until Sales picks it up, so its queries used to match no BDO's scope at all and
 * were invisible to the very people told to "assign a BDO". Sales scope therefore
 * also covers every customer nobody owns yet; POST /queries/:id/claim turns one
 * into a real assignment.
 */

export const requireQueryAccess = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "asm",
  "bdo",
  "web_manager",
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
      // bdo and/or web_manager. The legs COMPOSE for a multi-role user:
      //   ownerIds → raised-by / assigned-customer / unclaimed pool (sales, as before)
      //   website  → every query raised via the storefront/portal (the channel the
      //              web_manager owns by role, no claiming involved)
      const scope = {};
      if (hasRole(req.user, "bdo")) scope.ownerIds = [req.user.id];
      if (hasRole(req.user, "web_manager")) scope.website = true;
      req.queryScope = scope;
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

  const or = [];
  if (scope.ownerIds) {
    // Sales scope: raised by someone in scope, OR belonging to a customer
    // assigned to someone in scope, OR belonging to a customer nobody owns yet
    // (the unclaimed pool — storefront self-signups awaiting a BDO).
    const customers = await prisma.customer.findMany({
      where: { OR: [{ assignedBdoId: { in: scope.ownerIds } }, { assignedBdoId: null }] },
      select: { id: true },
    });
    or.push(
      { raisedById: { in: scope.ownerIds } },
      { customerId: { in: customers.map((c) => c.id) } },
    );
  }
  // Website channel (web_manager): every query raised via the storefront/portal.
  if (scope.website) or.push({ raisedVia: "portal" });
  return { ...extra, OR: or };
};

export const queryInScope = async (req, query) => {
  const scope = req.queryScope;
  if (!scope) return true;
  if (scope.customerId) return query.customerId === scope.customerId;
  if (scope.website && query.raisedVia === "portal") return true;
  if (!scope.ownerIds) return false;
  if (scope.ownerIds.includes(query.raisedById)) return true;
  const customer = await prisma.customer.findUnique({ where: { id: query.customerId } });
  return !!customer && salesOwnsCustomer(scope, customer);
};

/**
 * Does this sales scope cover the customer? Either it is assigned to someone in the
 * scope, or it is unclaimed and therefore fair game for any BDO/ASM to pick up.
 * Shared by the read path and by createQuery so a BDO cannot see a customer's query
 * without also being able to raise the next one.
 */
export const salesOwnsCustomer = (scope, customer) =>
  customer.assignedBdoId === null || scope.ownerIds.includes(customer.assignedBdoId);
