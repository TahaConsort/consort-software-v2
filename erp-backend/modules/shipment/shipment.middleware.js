import prisma from "../../config/prisma.js";
import { requireRole, isManagement, hasRole } from "../auth/auth.middleware.js";
import { teamUserIds } from "../lead/lead.middleware.js";

/**
 * Shipment access + row-level scope (BUSINESS_RULES §2.2/2.3).
 *   Management         all (A)
 *   Ops/Comp/Trans/Fin department (D) — any shipment with ≥1 composed-path
 *                      step owned by their department (RULE-SVC-02)
 *   ASM                team (T)   BDO   own (O)   Customer   own customer (C)
 *
 * req.shipmentScope:
 *   null                    → unrestricted
 *   { departmentCode }      → shipments with a step owned by this department
 *   { customerIds: [...] }  → shipments for these customers
 */
export const requireShipmentAccess = requireRole(
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
  "transport_manager",
  "transport_exec",
  "accounts",
  "customer",
);

// Which department each internal role belongs to for the `department` scope.
const ROLE_DEPARTMENT = {
  ops_manager: "operations",
  ops_exec: "operations",
  compliance_manager: "compliance",
  compliance_exec: "compliance",
  transport_manager: "transport",
  transport_exec: "transport",
  accounts: "finance",
};

/** The department CODE the user belongs to (via employee), or null. */
export const getUserDeptCode = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { employee: { select: { department: { select: { code: true } } } } },
  });
  return user?.employee?.department?.code ?? null;
};

export const attachShipmentScope = async (req, res, next) => {
  try {
    // Priority for a multi-role user: Management (all) → a department role's
    // department scope → portal customer → sales (asm team / bdo own).
    const deptRole = Object.keys(ROLE_DEPARTMENT).find((r) => hasRole(req.user, r));
    if (isManagement(req.user)) {
      req.shipmentScope = null;
    } else if (deptRole) {
      req.shipmentScope = { departmentCode: ROLE_DEPARTMENT[deptRole] };
    } else if (req.user.role === "customer") {
      req.shipmentScope = { customerIds: [req.user.customerId] };
    } else {
      // asm (team) / bdo (own) — via the customers they own
      const owners = hasRole(req.user, "asm") ? await teamUserIds(req.user) : [req.user.id];
      const customers = await prisma.customer.findMany({
        where: { assignedBdoId: { in: owners } },
        select: { id: true },
      });
      req.shipmentScope = { customerIds: customers.map((c) => c.id) };
    }
    next();
  } catch (err) {
    next(err);
  }
};

export const scopedShipmentWhere = (req, extra = {}) => {
  const scope = req.shipmentScope;
  if (!scope) return extra;
  if (scope.departmentCode) {
    return { ...extra, otdSteps: { some: { ownerDepartment: scope.departmentCode } } };
  }
  return { ...extra, customerId: { in: scope.customerIds } };
};

export const shipmentInScope = async (req, shipment) => {
  const scope = req.shipmentScope;
  if (!scope) return true;
  if (scope.customerIds) return scope.customerIds.includes(shipment.customerId);
  const step = await prisma.otdStep.findFirst({
    where: { shipmentId: shipment.id, ownerDepartment: scope.departmentCode },
    select: { id: true },
  });
  return !!step;
};
