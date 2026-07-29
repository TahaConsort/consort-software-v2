import jwt from "jsonwebtoken";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";

/**
 * Authentication & Access middleware (CRM_MASTER §5.1).
 *
 *  - `protect`             verifies the 15-min access token, re-checks the live
 *                          user, is_active and token_version (ADR-009, EDGE-A-03).
 *  - `requireRole(...r)`   coarse role gate.
 *  - `requirePermission()` permission gate off the role→permission map (ADR-005).
 *  - `requireManagement`   the five-role Management tier (ADR-044).
 *
 * Row-level scope (A/D/T/O/C in BUSINESS_RULES §2.3) is NOT enforced here — it
 * lives in each feature module's repository. This map is the coarse "can the
 * role do this action at all" gate that also powers the frontend's /me payload.
 */

export const MANAGEMENT_ROLES = ["ceo", "project_director", "director", "cfo", "gm"];

// ── Role → permission map — the flat rendering of BUSINESS_RULES §2.2 ──────────
const MANAGEMENT_PERMS = [
  "employee.create", "employee.read", "employee.update", "employee.deactivate", "employee.reassign",
  "lead.create", "lead.read", "lead.update", "lead.convert", "lead.reopen",
  "visit.read",
  "query.read",
  "quotation.read", "quotation.approve", "quotation.reject",
  "shipment.read", "shipment.step.reopen", "shipment.hold", "shipment.resume",
  "shipment.cancel", "shipment.close", "shipment.force_override", "shipment.schedule",
  "invoice.create",
  "task.read", "task.reassign",
  "document.upload", "document.read", "document.publish", "document.delete",
  "chat.read", "chat.send",
  "report.read", "audit.read", "dashboard.read",
  // Intake channels & storefront (CRM_MASTER §5.20/§5.21)
  "inquiry.read", "inquiry.convert", "lc.read", "lc.convert", "loadboard.manage",
  // Vendors — the counterparties on payable invoices
  "vendor.read", "vendor.manage",
];

export const PERMISSIONS_BY_ROLE = {
  ceo: MANAGEMENT_PERMS,
  project_director: MANAGEMENT_PERMS,
  director: MANAGEMENT_PERMS,
  cfo: MANAGEMENT_PERMS,
  gm: MANAGEMENT_PERMS,

  hr: [
    "employee.create", "employee.read", "employee.update", "employee.deactivate", "employee.reassign",
    "chat.read", "chat.send", "report.read", "dashboard.read",
  ],

  asm: [
    "lead.create", "lead.read", "lead.update", "lead.convert", "lead.reopen",
    "visit.create", "visit.read", "visit.update", "visit.complete",
    "query.create", "query.read", "query.update", "query.cancel",
    "quotation.read", "quotation.approve", "quotation.reject",
    "shipment.read",
    "task.read", "task.update", "task.complete", "task.reassign",
    "document.upload", "document.read", "document.publish", "document.delete",
    "chat.read", "chat.send", "report.read", "dashboard.read",
    "inquiry.read", "inquiry.convert",
    "vendor.read",
  ],

  bdo: [
    "lead.create", "lead.read", "lead.update", "lead.convert", "lead.reopen",
    "visit.create", "visit.read", "visit.update", "visit.complete",
    "query.create", "query.read", "query.update", "query.cancel",
    // Decide on quotes on the customer's behalf (verbal acceptance on a call),
    // scoped to the BDO's OWN queries — deliberate relaxation of RULE-QT-03.
    "quotation.read", "quotation.approve", "quotation.reject",
    "shipment.read",
    "task.read", "task.update", "task.complete",
    "document.upload", "document.read",
    "chat.read", "chat.send", "report.read", "dashboard.read",
    "inquiry.read", "inquiry.convert",
    "vendor.read",
  ],

  ops_manager: [
    "query.read",
    "quotation.create", "quotation.read", "quotation.send", "quotation.revise",
    "shipment.read", "shipment.step.complete", "shipment.step.reopen",
    "shipment.hold", "shipment.resume", "shipment.cancel", "shipment.close", "shipment.force_override", "shipment.schedule",
    "invoice.create",
    "task.read", "task.update", "task.complete", "task.reassign",
    "document.upload", "document.read", "document.publish", "document.delete",
    "chat.read", "chat.send", "report.read", "dashboard.read",
    "lc.read", "lc.convert", "loadboard.manage",
    "vendor.read", "vendor.manage",
  ],

  ops_exec: [
    "query.read",
    "quotation.create", "quotation.read", "quotation.revise",
    "shipment.read", "shipment.step.complete", "shipment.schedule",
    "task.read", "task.update", "task.complete",
    "document.upload", "document.read",
    "chat.read", "chat.send", "dashboard.read",
    "lc.read", "lc.convert",
    "vendor.read",
  ],

  compliance_manager: [
    "query.read",
    "shipment.read", "shipment.step.complete", "shipment.step.reopen", "shipment.hold", "shipment.resume",
    "invoice.create",
    "task.read", "task.update", "task.complete", "task.reassign",
    "document.upload", "document.read", "document.publish", "document.delete",
    "chat.read", "chat.send", "report.read", "dashboard.read",
    "vendor.read",
  ],

  compliance_exec: [
    "query.read",
    "shipment.read", "shipment.step.complete",
    "task.read", "task.update", "task.complete",
    "document.upload", "document.read",
    "chat.read", "chat.send", "dashboard.read",
  ],

  transport_manager: [
    "shipment.read", "shipment.step.complete", "shipment.step.reopen", "shipment.hold", "shipment.resume",
    "invoice.create",
    "task.read", "task.update", "task.complete", "task.reassign",
    "document.upload", "document.read",
    "chat.read", "chat.send", "report.read", "dashboard.read",
    "loadboard.manage",
    "vendor.read", "vendor.manage",
  ],

  // Mirrors compliance_exec. Transport owns 5 of the 6 steps on a Local Transport job,
  // and transport_manager was previously the department's only member — so every one of
  // those tasks routed to one person (resolveAssignee, RULE-AE-03).
  transport_exec: [
    "shipment.read", "shipment.step.complete",
    "task.read", "task.update", "task.complete",
    "document.upload", "document.read",
    "chat.read", "chat.send", "dashboard.read",
  ],

  accounts: [
    "shipment.read", "shipment.step.complete",
    "otc.update", "invoice.create", "invoice.issue", "invoice.void", "payment.record",
    "task.read", "task.update", "task.complete",
    "document.upload", "document.read", "document.publish", "document.delete",
    "chat.read", "chat.send", "report.read", "dashboard.read",
    "vendor.read", "vendor.manage",
  ],

  customer: [
    "query.create", "query.read", "query.update", "query.cancel",
    "quotation.read", "quotation.approve", "quotation.reject",
    "shipment.read",
    // Inbound uploads only — a customer who supplies their own CRO has to be able to
    // send it in. Deliberately narrow: `ownerInScope` restricts writes to shipments
    // belonging to their own customer, and the upload controller enforces a docType
    // allowlist (CUSTOMER_UPLOADABLE_DOC_TYPES). Note there is no `document.publish`
    // or `document.delete` — a customer can never expose or remove a document.
    "document.upload", "document.read",
    "dashboard.read",
  ],
};

export const getPermissionsForRole = (role) => PERMISSIONS_BY_ROLE[role] ?? [];

// Union of every held role's permissions — the effective permission set of a
// multi-role employee (INV-01 relaxed: a User may hold several roles).
export const getPermissionsForRoles = (roles) => [
  ...new Set((roles ?? []).flatMap((r) => PERMISSIONS_BY_ROLE[r] ?? [])),
];

// The full role set of a user object, tolerating legacy rows that only carry the
// singular `role` (before the `roles` column is backfilled).
export const rolesOf = (user) =>
  user?.roles?.length ? user.roles : user?.role ? [user.role] : [];

// Polymorphic: accepts a role string, an array of roles, or a user object.
export const isManagement = (roleOrRolesOrUser) => {
  if (roleOrRolesOrUser == null) return false;
  if (typeof roleOrRolesOrUser === "string") return MANAGEMENT_ROLES.includes(roleOrRolesOrUser);
  const list = Array.isArray(roleOrRolesOrUser) ? roleOrRolesOrUser : rolesOf(roleOrRolesOrUser);
  return list.some((r) => MANAGEMENT_ROLES.includes(r));
};

// True when the user holds ANY of the given roles (multi-role aware).
export const hasRole = (user, ...roles) => rolesOf(user).some((r) => roles.includes(r));

// ── protect ───────────────────────────────────────────────────────────────────
export const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return next(new AppError("Not authorized, no token", 401));
    }

    const token = header.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return next(new AppError("Not authorized, token failed", 401));
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        role: true,
        roles: true,
        isActive: true,
        tokenVersion: true,
        employeeId: true,
        customerId: true,
      },
    });

    if (!user || !user.isActive) {
      return next(new AppError("Not authorized, account inactive", 401));
    }

    // Global invalidation — a role change / logout-all bumps token_version (EDGE-A-03).
    if (decoded.tv !== user.tokenVersion) {
      return next(new AppError("Session expired, please sign in again", 401));
    }

    // Effective roles (fallback to the primary role for un-backfilled rows); the
    // permission set is the UNION across every held role.
    const roles = rolesOf(user);
    req.user = { ...user, roles, permissions: getPermissionsForRoles(roles) };
    next();
  } catch (err) {
    next(err);
  }
};

// ── requireRole ────────────────────────────────────────────────────────────────
// Passes when the user holds ANY of the listed roles (multi-role aware).
export const requireRole = (...roles) => (req, res, next) => {
  if (req.user && hasRole(req.user, ...roles)) return next();
  next(new AppError("Forbidden: insufficient role", 403));
};

// ── requireManagement ──────────────────────────────────────────────────────────
export const requireManagement = (req, res, next) => {
  if (req.user && isManagement(req.user)) return next();
  next(new AppError("Forbidden: management only", 403));
};

// ── requirePermission ───────────────────────────────────────────────────────────
export const requirePermission = (...permissions) => (req, res, next) => {
  const held = req.user?.permissions ?? [];
  if (permissions.every((p) => held.includes(p))) return next();
  next(new AppError("Forbidden: missing permission", 403));
};
