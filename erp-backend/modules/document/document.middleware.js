import path from "path";
import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { requireRole, isManagement, hasRole, rolesOf } from "../auth/auth.middleware.js";
import { teamUserIds } from "../lead/lead.middleware.js";
import { getUserDeptCode } from "../shipment/shipment.middleware.js";
import { UPLOAD_ROOT, ensureDir } from "./document.service.js";

/**
 * Documents access, polymorphic scope, and the OPTIONAL multer loader
 * (CRM_MASTER §5.13, RULE-DOC-01/02/03, INV-10/11).
 *
 * `multer` is loaded DYNAMICALLY so the app boots without it (the user installs
 * packages manually). Until `npm i multer` runs, upload returns a clear 503 and
 * every other endpoint is unaffected.
 */

export const requireDocumentAccess = requireRole(
  "ceo", "project_director", "director", "cfo", "gm",
  "hr", "asm", "bdo", "ops_manager", "ops_exec",
  "compliance_manager", "compliance_exec", "transport_manager", "transport_exec", "accounts", "customer",
);

const ROLE_DEPARTMENT = {
  ops_manager: "operations", ops_exec: "operations",
  compliance_manager: "compliance", compliance_exec: "compliance",
  transport_manager: "transport", transport_exec: "transport", accounts: "finance",
};

// The department code for the first department-bearing role the user holds (a
// multi-role employee may carry, e.g., both ops_exec and bdo).
const deptCodeOfUser = (user) => {
  for (const r of rolesOf(user)) if (ROLE_DEPARTMENT[r]) return ROLE_DEPARTMENT[r];
  return null;
};

// ── optional multer loader ────────────────────────────────────────────────────
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png", "image/jpeg", "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv",
]);

let _upload = null;
let _loadFailed = false;
const buildUpload = async () => {
  if (_upload) return _upload;
  if (_loadFailed) return null;
  try {
    const multer = (await import("multer")).default;
    ensureDir();
    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || "").slice(0, 12);
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    });
    _upload = multer({
      storage,
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB (RULE-DOC-02 size cap)
      fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
    });
    return _upload;
  } catch {
    _loadFailed = true;
    return null;
  }
};

/** Multipart single-file middleware; 503 if multer isn't installed yet. */
export const uploadSingle = (field) => async (req, res, next) => {
  const upload = await buildUpload();
  if (!upload) {
    return next(new AppError("File upload unavailable — run `npm i multer` in erp-backend", 503));
  }
  upload.single(field)(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "File exceeds the 25 MB limit" : err.message || "Upload failed";
      return next(new AppError(msg, 400));
    }
    next();
  });
};

// ── polymorphic scope (RULE-DOC-03 — documents follow the parent's scope) ──────

/** Resolve an owner to a { shipmentId?, customerId?, ownerUserId?, departmentId? } context. */
export const resolveOwner = async (ownerType, ownerId) => {
  switch (ownerType) {
    case "shipment": {
      const s = await prisma.shipment.findUnique({ where: { id: ownerId }, select: { id: true, customerId: true } });
      return s ? { shipmentId: s.id, customerId: s.customerId } : null;
    }
    case "task": {
      const t = await prisma.task.findUnique({ where: { id: ownerId }, select: { shipmentId: true, departmentId: true } });
      if (!t) return null;
      if (t.shipmentId) {
        const s = await prisma.shipment.findUnique({ where: { id: t.shipmentId }, select: { customerId: true } });
        return { shipmentId: t.shipmentId, customerId: s?.customerId, departmentId: t.departmentId };
      }
      return { departmentId: t.departmentId };
    }
    case "query": {
      const q = await prisma.query.findUnique({ where: { id: ownerId }, select: { customerId: true } });
      return q ? { customerId: q.customerId } : null;
    }
    case "quotation": {
      const q = await prisma.quotation.findUnique({ where: { id: ownerId }, select: { query: { select: { customerId: true } } } });
      return q ? { customerId: q.query?.customerId } : null;
    }
    case "customer":
      return { customerId: ownerId };
    case "lead": {
      const l = await prisma.lead.findUnique({ where: { id: ownerId }, select: { ownerId: true } });
      return l ? { ownerUserId: l.ownerId } : null;
    }
    default:
      return {};
  }
};

/** Does a shipment fall in this user's scope? Mirrors shipment.middleware. */
const shipmentInScopeForUser = async (user, shipmentId, customerId) => {
  if (isManagement(user)) return true;
  if (user.role === "customer") return customerId === user.customerId;
  const deptCode = deptCodeOfUser(user);
  if (deptCode) {
    const step = await prisma.otdStep.findFirst({ where: { shipmentId, ownerDepartment: deptCode }, select: { id: true } });
    if (step) return true;
    // fall through — a user who is ALSO sales may still reach it via their book
  }
  // sales — via the owning customer
  const owners = hasRole(user, "asm") ? await teamUserIds(user) : [user.id];
  const cust = await prisma.customer.findFirst({ where: { id: customerId, assignedBdoId: { in: owners } }, select: { id: true } });
  return !!cust;
};

/** Is a customer in this sales user's book? */
const customerInSalesScope = async (user, customerId) => {
  if (!customerId) return false;
  const owners = hasRole(user, "asm") ? await teamUserIds(user) : [user.id];
  const cust = await prisma.customer.findFirst({ where: { id: customerId, assignedBdoId: { in: owners } }, select: { id: true } });
  return !!cust;
};

/**
 * Doc types a portal customer may send IN. Everything else — and publishing or
 * deleting anything at all — stays internal (INV-10/§2.2).
 *
 * `cro` is the reason this list exists: a customer on the loading-point-to-port package
 * who supplies their own CRO has to be able to hand it over. The rest are their own
 * trade documents, which they are the natural source of.
 */
export const CUSTOMER_UPLOADABLE_DOC_TYPES = [
  "cro",
  "commercial_invoice",
  "packing_list",
  "authority_letterhead",
];

/**
 * Can this user act on documents of this owner? `forWrite` = upload/publish/delete.
 *
 * A customer may WRITE only to a shipment of their own, and only an inbound doc type —
 * the docType allowlist itself is enforced in the upload controller, because
 * `req.body.docType` does not exist until multer has parsed the multipart body.
 * Publish and delete are blocked by permission (the customer role holds neither
 * `document.publish` nor `document.delete`).
 *
 * Returns true/false; the controller additionally filters unpublished rows out for
 * customers on read.
 */
export const ownerInScope = async (user, ownerType, ownerId, { forWrite = false } = {}) => {
  const ctx = await resolveOwner(ownerType, ownerId);
  if (ctx === null) return false; // owner does not exist → 404
  if (isManagement(user)) return true;

  if (user.role === "customer") {
    // Inbound uploads are confined to the customer's OWN shipments; nothing else.
    if (forWrite && ownerType !== "shipment") return false;
    return !!ctx.customerId && ctx.customerId === user.customerId;
  }

  // internal, non-management
  if (ctx.shipmentId) return shipmentInScopeForUser(user, ctx.shipmentId, ctx.customerId);
  if (ctx.customerId) {
    // ops/compliance/transport/finance have department-wide read of customer-linked docs
    if (deptCodeOfUser(user)) return true;
    return customerInSalesScope(user, ctx.customerId);
  }
  if (ctx.ownerUserId) {
    if (hasRole(user, "asm")) return (await teamUserIds(user)).includes(ctx.ownerUserId);
    if (hasRole(user, "bdo")) return ctx.ownerUserId === user.id;
    return deptCodeOfUser(user) ? false : true;
  }
  // department-scoped owners (e.g. a queue task) or misc — allow internal with the permission
  return true;
};
