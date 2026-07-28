import prisma from "../../config/prisma.js";
import { requireRole, isManagement, hasRole } from "../auth/auth.middleware.js";
import { teamUserIds } from "../lead/lead.middleware.js";

/**
 * Quotation access + scope (BUSINESS_RULES §2.2/2.3).
 *   Ops (mgr/exec)  draft/revise/send + read (dept D → all quotations)
 *   Management      read + approve/reject (A)
 *   ASM             read + approve/reject on the customer's behalf (team T)
 *   BDO             read + approve/reject on the customer's behalf, but ONLY for
 *                   queries they raised (scope O — product decision 2026-07)
 *   Customer        read + approve/reject own (C)
 *
 * Scope resolves to req.quotationScope:
 *   null                → unrestricted (Management, Ops)
 *   { queryIds: [...] } → restrict to quotations for these queries
 */
export const requireQuotationAccess = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "asm",
  "bdo",
  "ops_manager",
  "ops_exec",
  "customer",
);

const OPS_ROLES = ["ops_manager", "ops_exec"];

export const attachQuotationScope = async (req, res, next) => {
  try {
    // Broadest scope wins for a multi-role user: Ops/Management (all) beats ASM
    // team, which beats BDO own-queries.
    if (isManagement(req.user) || hasRole(req.user, ...OPS_ROLES)) {
      req.quotationScope = null;
    } else if (req.user.role === "customer") {
      const queries = await prisma.query.findMany({
        where: { customerId: req.user.customerId },
        select: { id: true },
      });
      req.quotationScope = { queryIds: queries.map((q) => q.id) };
    } else if (hasRole(req.user, "asm")) {
      // asm — team closure via the customers their team owns
      const owners = await teamUserIds(req.user);
      const customers = await prisma.customer.findMany({
        where: { assignedBdoId: { in: owners } },
        select: { id: true },
      });
      const queries = await prisma.query.findMany({
        where: { customerId: { in: customers.map((c) => c.id) } },
        select: { id: true },
      });
      req.quotationScope = { queryIds: queries.map((q) => q.id) };
    } else {
      // bdo — only quotations for queries THEY raised (scope O). This governs
      // both read and the approve/reject decision (quotationInScope).
      const queries = await prisma.query.findMany({
        where: { raisedById: req.user.id },
        select: { id: true },
      });
      req.quotationScope = { queryIds: queries.map((q) => q.id) };
    }
    next();
  } catch (err) {
    next(err);
  }
};

export const scopedQuotationWhere = (req, extra = {}) => {
  const scope = req.quotationScope;
  if (!scope) return extra;
  return { ...extra, queryId: { in: scope.queryIds } };
};

export const quotationInScope = (req, quotation) =>
  !req.quotationScope || req.quotationScope.queryIds.includes(quotation.queryId);
