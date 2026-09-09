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
  // No `quotation.approve` for anyone internal since ADR-056: a shipment is born only
  // from the customer's own acceptance. Management records the claim and relays the
  // secure link like the sales floor does.
  "quotation.read", "quotation.share", "quotation.reject",
  "shipment.read", "shipment.step.reopen", "shipment.hold", "shipment.resume",
  "shipment.cancel", "shipment.close", "shipment.force_override", "shipment.schedule",
  "invoice.create",
  "task.read", "task.reassign",
  "document.upload", "document.read", "document.publish", "document.delete",
  "chat.read", "chat.send",
  "report.read", "audit.read", "dashboard.read",
  // Intake channel (CRM_MASTER §5.21)
  "lc.read", "lc.convert",
  // Vendors — the counterparties on payable invoices
  "vendor.read", "vendor.manage",
  // Vendor rate requests — the buy side of a query
  "rfq.read", "rfq.manage", "rfq.award",
  // Own fleet — drivers, trucks, dumpers
  "fleet.read", "fleet.manage",
  // Workflow catalog admin (ADR-051) — steps, checklists, document types
  "workflow.manage",
  // Export trade documents (roadmap §4) — Management sees and does everything
  "trade.read", "trade.party.manage", "trade.contract.manage",
  "trade.cargo.manage", "trade.transport.manage", "trade.customs.manage",
  "trade.invoice.manage", "trade.invoice.issue",
  "fi.manage", "fi.close",
  // Ops shipment ownership — Management reassigns or releases a claimed shipment.
  "shipment.assign",
  // Signed-document verification (Rate Confirmation before Order Lock).
  "document.verify",
];

// ── Operations — ONE permission set for both ops roles (product decision
// 2026-09-08: "only one role for ops for now"). `ops_manager` and `ops_exec` stay
// as enum values so existing users and the ~30 hardcoded role lists keep working,
// but they can do exactly the same things. This deliberately collapses the former
// manager-only gates — quotation.send (RULE-QT-01 four-eyes on outbound pricing),
// shipment.force_override, shipment.close (RULE-SH-12), hold/resume/cancel,
// document.publish/delete, vendor.manage — onto every ops user. Four-eyes on
// money now sits at quotation APPROVAL (a different role decides) and at invoice
// ISSUE (Accounts). Re-split here if the desk grows a real manager tier again.
const OPS_PERMS = [
  "query.read",
  "quotation.create", "quotation.read", "quotation.send", "quotation.revise",
  "shipment.read", "shipment.step.complete", "shipment.step.reopen",
  "shipment.hold", "shipment.resume", "shipment.cancel", "shipment.close", "shipment.force_override", "shipment.schedule",
  // Take ownership of a shipment — from then on only the owner works its steps and flow.
  "shipment.claim",
  "invoice.create",
  "task.read", "task.update", "task.complete", "task.reassign",
  "document.upload", "document.read", "document.publish", "document.delete",
  // Verify the customer's signed Rate Confirmation — the gate on Order Lock.
  "document.verify",
  "chat.read", "chat.send", "report.read", "dashboard.read",
  "lc.read", "lc.convert",
  "vendor.read", "vendor.manage",
  // Ops runs the rate requests end to end — they are the ones on the phone to the
  // transporter, so they also pick the winning vendor.
  "rfq.read", "rfq.manage", "rfq.award",
  // Ops keeps the fleet masters current — they meet the driver and the truck.
  "fleet.read", "fleet.manage",
  // Operations owns the cargo-side paperwork: parties, containers, packing list,
  // B/L, and the PURCHASE commercial invoice (the vendor billing Consort).
  // Issuing the SALE invoice is deliberately withheld — that is Accounts (four-eyes).
  "trade.read", "trade.party.manage", "trade.contract.manage",
  "trade.cargo.manage", "trade.transport.manage", "trade.invoice.manage",
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
    // Pick up a storefront self-signup nobody owns yet (§5.20).
    "query.claim",
    "quotation.read", "quotation.share", "quotation.reject",
    "shipment.read",
    "task.read", "task.update", "task.complete", "task.reassign",
    "document.upload", "document.read", "document.publish", "document.delete",
    "chat.read", "chat.send", "report.read", "dashboard.read",
    "vendor.read",
    // Sales owns the customer relationship behind a trade contract, not the cargo
    "trade.read", "trade.contract.manage",
  ],

  bdo: [
    "lead.create", "lead.read", "lead.update", "lead.convert", "lead.reopen",
    "visit.create", "visit.read", "visit.update", "visit.complete",
    "query.create", "query.read", "query.update", "query.cancel",
    // Pick up a storefront self-signup nobody owns yet (§5.20).
    "query.claim",
    // quotation.share: give a SENT quote to the customer over mail/phone/WhatsApp,
    // record the customer's verbal acceptance and relay the secure link — for any
    // customer origin (form / bank LC / BDO). The former on-behalf `quotation.approve`
    // is gone (ADR-056): a verbal yes is recorded as a claim, and the shipment is
    // created only by the customer's own act or a signed copy Operations verified.
    "quotation.read", "quotation.share", "quotation.reject",
    "shipment.read",
    "task.read", "task.update", "task.complete",
    "document.upload", "document.read",
    "chat.read", "chat.send", "report.read", "dashboard.read",
    "vendor.read",
    "trade.read",
  ],

  // Both ops roles share OPS_PERMS — see the note above it.
  ops_manager: OPS_PERMS,
  ops_exec: OPS_PERMS,

  // Owns the WEBSITE query channel (queries raised via the storefront/portal).
  // Sales-shaped but channel-scoped: query/quotation middleware limits every read
  // and write to raisedVia = portal queries. No lead/visit/claim surface — the
  // channel is theirs by role, not by claiming customers.
  web_manager: [
    "query.read", "query.update", "query.cancel",
    "quotation.read", "quotation.share", "quotation.reject",
    "document.upload", "document.read",
    "chat.read", "chat.send", "report.read", "dashboard.read",
  ],

  compliance_manager: [
    "query.read",
    "shipment.read", "shipment.step.complete", "shipment.step.reopen", "shipment.hold", "shipment.resume",
    "invoice.create",
    "task.read", "task.update", "task.complete", "task.reassign",
    "document.upload", "document.read", "document.publish", "document.delete",
    "chat.read", "chat.send", "report.read", "dashboard.read",
    "vendor.read",
    // Compliance files the Goods Declaration — mirrors step 95 customs_clearance
    // being compliance-owned (RULE-SH-04).
    "trade.read", "trade.party.manage", "trade.customs.manage",
  ],

  compliance_exec: [
    "query.read",
    "shipment.read", "shipment.step.complete",
    "task.read", "task.update", "task.complete",
    "document.upload", "document.read",
    "chat.read", "chat.send", "dashboard.read",
    "trade.read", "trade.customs.manage",
  ],

  transport_manager: [
    "shipment.read", "shipment.step.complete", "shipment.step.reopen", "shipment.hold", "shipment.resume",
    "invoice.create",
    "task.read", "task.update", "task.complete", "task.reassign",
    "document.upload", "document.read",
    "chat.read", "chat.send", "report.read", "dashboard.read",
    "vendor.read", "vendor.manage",
    "fleet.read", "fleet.manage",
    "trade.read",
  ],

  // Mirrors compliance_exec. Transport owns 5 of the 6 steps on a Local Transport job,
  // and transport_manager was previously the department's only member — so every one of
  // those tasks routed to one person (resolveAssignee, RULE-AE-03).
  transport_exec: [
    "shipment.read", "shipment.step.complete",
    "task.read", "task.update", "task.complete",
    "document.upload", "document.read",
    "chat.read", "chat.send", "dashboard.read",
    "trade.read",
  ],

  accounts: [
    "shipment.read", "shipment.step.complete",
    "otc.update", "invoice.create", "invoice.issue", "invoice.void", "payment.record",
    "task.read", "task.update", "task.complete",
    "document.upload", "document.read", "document.publish", "document.delete",
    "chat.read", "chat.send", "report.read", "dashboard.read",
    "vendor.read", "vendor.manage",
    // The Financial Instrument is a bank instrument with a ceiling, an expiry and a
    // balance — the same department that owns invoices and payments owns it. Accounts
    // also ISSUES the sale commercial invoice, which drafts the receivable and
    // completes OTC milestone 1 (RULE-FI-02).
    "trade.read", "trade.invoice.manage", "trade.invoice.issue",
    "fi.manage", "fi.close",
  ],

  customer: [
    "query.create", "query.read", "query.update", "query.cancel",
    // The ONLY holder of `quotation.approve` (ADR-056): the portal click is the
    // customer's own act, which is exactly what a binding order needs behind it.
    "quotation.read", "quotation.approve", "quotation.reject",
    "shipment.read",
    // Inbound uploads only — a customer who supplies their own CRO has to be able to
    // send it in. Deliberately narrow: `ownerInScope` restricts writes to shipments
    // belonging to their own customer, and the upload controller enforces a docType
    // allowlist (CUSTOMER_UPLOADABLE_DOC_TYPES). Note there is no `document.publish`
    // or `document.delete` — a customer can never expose or remove a document.
    "document.upload", "document.read",
    "dashboard.read",
    // Read-only, and hard-filtered server-side: a customer never sees a PURCHASE
    // invoice (what Consort paid the vendor), the Financial Instrument, the goods
    // margin, GD assessed values, or any party's bank details.
    "trade.read",
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

    // Global invalidation — a role change / password reset bumps token_version (EDGE-A-03).
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
