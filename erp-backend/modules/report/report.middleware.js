import { requireRole, isManagement, hasRole } from "../auth/auth.middleware.js";
import { teamUserIds } from "../lead/lead.middleware.js";
import { getUserDeptCode } from "../shipment/shipment.middleware.js";
import { AppError } from "../../utils/AppError.js";
import prisma from "../../config/prisma.js";

/**
 * Reports access + scope (CRM_MASTER §5.18, BUSINESS_RULES §2.2 report.read).
 *   mgmt A · hr D(HR) · asm T · bdo O · ops_mgr/comp_mgr/transport_mgr/accounts D
 * `ops_exec`, `compliance_exec` and `customer` have no report access.
 */
export const requireReportAccess = requireRole(
  "ceo", "project_director", "director", "cfo", "gm",
  "hr", "asm", "bdo", "ops_manager", "compliance_manager", "transport_manager", "accounts",
);

const ROLE_DEPARTMENT = {
  ops_manager: "operations",
  compliance_manager: "compliance",
  transport_manager: "transport",
  accounts: "finance",
};

/**
 * Resolve the reporting scope for the live role (the role determines the view,
 * §5.17). Sets req.reportScope:
 *   { all: true }                              → Management / HR
 *   { ownerIds, customerIds }                  → Sales (asm team / bdo own)
 *   { departmentCode }                         → Ops / Compliance / Transport / Finance
 */
export const attachReportScope = async (req, res, next) => {
  try {
    const deptRole = Object.keys(ROLE_DEPARTMENT).find((r) => hasRole(req.user, r));
    if (isManagement(req.user) || hasRole(req.user, "hr")) {
      req.reportScope = { all: true };
    } else if (hasRole(req.user, "asm", "bdo")) {
      const ownerIds = hasRole(req.user, "asm") ? await teamUserIds(req.user) : [req.user.id];
      const customers = await prisma.customer.findMany({
        where: { assignedBdoId: { in: ownerIds } },
        select: { id: true },
      });
      req.reportScope = { ownerIds, customerIds: customers.map((c) => c.id) };
    } else {
      req.reportScope = { departmentCode: ROLE_DEPARTMENT[deptRole] ?? (await getUserDeptCode(req.user.id)) };
    }
    next();
  } catch (err) {
    next(err);
  }
};

/** Finance-grade reports (revenue) — Management + Accounts only. */
export const requireRevenueAccess = (req, res, next) => {
  if (isManagement(req.user) || hasRole(req.user, "accounts")) return next();
  return next(new AppError("Revenue reporting is restricted to Finance and Management", 403));
};
