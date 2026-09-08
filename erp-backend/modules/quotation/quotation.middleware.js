import prisma from "../../config/prisma.js";
import { requireRole, isManagement, hasRole } from "../auth/auth.middleware.js";
import { teamUserIds } from "../lead/lead.middleware.js";

/**
 * Quotation access + scope (BUSINESS_RULES §2.2/2.3).
 *   Ops (mgr/exec)  draft/revise/send + read (dept D → all quotations)
 *   Management      read + approve/reject (A)
 *   ASM             read + approve/reject on the customer's behalf (team T)
 *   BDO             read + share for queries they raised OR customers assigned to
 *                   them (form/LC customers included); approve/reject stays ONLY
 *                   for queries they raised (product decision 2026-07)
 *   Web manager     read + share + approve/reject for the WEBSITE channel only
 *                   (queries with raisedVia = portal)
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
  "web_manager",
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
      // bdo and/or web_manager — the legs compose for a multi-role user.
      //
      // bdo: quotations for queries THEY raised, plus queries of customers
      // ASSIGNED to them. The second leg is what lets a BDO give a quote to a
      // customer who came in through the storefront form (query raised by the
      // portal user) or a bank LC (query raised by the converting ops user) —
      // claiming/routing assigns the CUSTOMER, not the query. Approve/reject
      // stays raised-by-them only via the explicit guard in approveQuotation.
      //
      // web_manager: quotations for every WEBSITE-channel query (raisedVia =
      // portal) — the channel is theirs by role.
      const or = [];
      if (hasRole(req.user, "bdo")) {
        const mine = await prisma.customer.findMany({
          where: { assignedBdoId: req.user.id },
          select: { id: true },
        });
        or.push(
          { raisedById: req.user.id },
          { customerId: { in: mine.map((c) => c.id) } },
        );
      }
      if (hasRole(req.user, "web_manager")) or.push({ raisedVia: "portal" });
      const queries = await prisma.query.findMany({
        where: { OR: or },
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
