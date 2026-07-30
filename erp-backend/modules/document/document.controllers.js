import fs from "fs";
import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { ownerInScope } from "./document.middleware.js";
import {
  absPathFor,
  checksumFile,
  safeUnlink,
  sniffMatchesMime,
  requiredDocTypesByStep,
  isStepMandatoryDoc,
} from "./document.service.js";
import { getDocTypes, isValidDocType, isCustomerUploadable, customerUploadableCodes } from "./docTypes.cache.js";
import { lockReason } from "../shipment/shipment.service.js";

/**
 * A locked order's paperwork is frozen with it (RULE-SH-12) — no new uploads,
 * no publishing, no deletes. Non-shipment owners (leads, customers…) never lock.
 * @returns a refusal string, or null when writing is allowed
 */
const shipmentLockReason = async (ownerType, ownerId, action) => {
  if (ownerType !== "shipment") return null;
  const shipment = await prisma.shipment.findUnique({ where: { id: ownerId } });
  return lockReason(shipment, action);
};

/**
 * Announce a document change (ADR-020 — inside the caller's transaction, so nothing is
 * emitted for a write that rolled back).
 *
 * This module emitted no events at all, which was a real gap rather than an omission: a
 * `document` step sub-action's `satisfied` and the RULE-SH-06 miss set are both DERIVED
 * server-side from the files on record at read time. So attaching a document silently
 * changes whether a step can be completed, and with no event, nobody else's open stepper
 * could know — the Complete button stayed disabled until they reloaded the page.
 *
 * INV-10 on the audience: the customer room is included only when the change is theirs to
 * see — a publish, or their own upload. An internal-only attachment is not portal news,
 * and nudging the portal to refetch something it cannot see is a side channel, not a
 * feature.
 */
const emitDocumentsChanged = async (tx, doc, { change, actorRole }) => {
  const payload = {
    ownerType: doc.ownerType,
    ownerId: doc.ownerId,
    change,
    docType: doc.docType ?? null,
    documentId: doc.id,
    shipmentId: doc.ownerType === "shipment" ? doc.ownerId : null,
    customerId: null,
  };

  if (doc.ownerType === "shipment" && (change === "publish" || actorRole === "customer")) {
    const shipment = await tx.shipment.findUnique({
      where: { id: doc.ownerId },
      select: { customerId: true },
    });
    payload.customerId = shipment?.customerId ?? null;
  }

  await tx.outboxEvent.create({
    data: {
      eventType: "shipment.documents.changed",
      payload,
      correlationId: crypto.randomUUID(),
    },
  });
};

/**
 * Documents (CRM_MASTER §5.13, RULE-DOC). Polymorphic ownership, internal by
 * default (INV-10). Legal documents (GD, BOL, POD …) attached here are what gate
 * OTD step completion (RULE-SH-06) — a shipment cannot advance past a step whose
 * mandatory document is missing. Every mutation is audited (INV-15).
 */

const audit = (tx, actorId, action, doc, diff) =>
  tx.auditLog.create({
    data: {
      actorId: actorId ?? null,
      action,
      resourceType: "document",
      resourceId: doc.id,
      diff: diff ?? undefined,
      correlationId: crypto.randomUUID(),
    },
  });

const publicShape = (d) => ({
  id: d.id,
  ownerType: d.ownerType,
  ownerId: d.ownerId,
  otdStepId: d.otdStepId ?? null,
  fileName: d.fileName,
  mimeType: d.mimeType,
  sizeBytes: d.sizeBytes,
  docType: d.docType,
  isPublished: d.isPublished,
  scanStatus: d.scanStatus,
  uploadedById: d.uploadedById,
  publishedAt: d.publishedAt,
  createdAt: d.createdAt,
});

/* ── GET /api/documents/types ── the active docType vocabulary (ADR-051) */
// Every authenticated caller may read it: pickers and label maps need it everywhere
// the upload button exists, portal included.
export const listDocTypes = catchAsync(async (req, res) => {
  const rows = await getDocTypes();
  res.json({
    success: true,
    data: rows
      .filter((t) => t.active)
      .map((t) => ({ code: t.code, label: t.label, customerUploadable: t.customerUploadable })),
  });
});

/* ── POST /api/documents ── (multipart: file + ownerType + ownerId + docType) */
export const uploadDocument = catchAsync(async (req, res, next) => {
  if (!req.file) return next(new AppError("No file received (field name must be 'file')", 400));
  const { ownerType, ownerId, docType, otdStepId } = req.body;

  // Scope: the owner must exist and be in the uploader's write scope (RULE-DOC-03).
  const allowed = await ownerInScope(req.user, ownerType, ownerId, { forWrite: true });
  if (!allowed) {
    safeUnlink(req.file.path); // don't leave an orphan for a rejected upload
    return next(new AppError("Owner not found", 404));
  }

  // The docType must exist and be active in the document_types vocabulary (ADR-051) —
  // Zod only format-checks it, because the table lookup is async.
  if (docType && !(await isValidDocType(docType))) {
    safeUnlink(req.file.path);
    return next(new AppError("Unknown document type", 422));
  }

  // A portal customer may only send IN the customer-uploadable doc types (a flag on
  // document_types since ADR-051), and may only hand over a CRO/LC on a shipment where
  // THEY are the agreed source of that document. Enforced here rather than in
  // `ownerInScope` because `req.body.docType` does not exist until multer has parsed the
  // multipart body.
  if (req.user.role === "customer") {
    if (!docType || !(await isCustomerUploadable(docType))) {
      safeUnlink(req.file.path);
      const allowedCodes = await customerUploadableCodes();
      return next(
        new AppError(
          `You can only upload: ${allowedCodes.join(", ")}. Anything else is issued by Consort.`,
          403,
        ),
      );
    }
    if (docType === "cro" || docType === "lc") {
      const shipment = await prisma.shipment.findUnique({
        where: { id: ownerId },
        select: { croHandledBy: true, lcHandledBy: true },
      });
      if (docType === "cro" && shipment?.croHandledBy !== "customer") {
        safeUnlink(req.file.path);
        return next(new AppError("Consort is arranging the CRO for this shipment", 409));
      }
      if (docType === "lc" && shipment?.lcHandledBy !== "customer") {
        safeUnlink(req.file.path);
        return next(new AppError("Consort is managing the LC for this shipment", 409));
      }
    }
  }

  // A step link is only meaningful on a shipment, and the step must be on it.
  if (otdStepId) {
    const step = ownerType === "shipment"
      ? await prisma.otdStep.findFirst({ where: { id: otdStepId, shipmentId: ownerId }, select: { id: true } })
      : null;
    if (!step) {
      safeUnlink(req.file.path);
      return next(new AppError("Step not found on this shipment", 400));
    }
  }

  const locked = await shipmentLockReason(ownerType, ownerId, "attach documents to it");
  if (locked) {
    safeUnlink(req.file.path);
    return next(new AppError(locked, 409));
  }

  // RULE-DOC-02 — the real file signature must match its declared type.
  if (!(await sniffMatchesMime(req.file.path, req.file.mimetype))) {
    safeUnlink(req.file.path);
    return next(new AppError("File content does not match its type", 400));
  }

  const checksum = await checksumFile(req.file.path);

  // Checksum dedup (RULE-DOC-02): identical bytes already on this owner → reuse.
  const dup = await prisma.document.findFirst({
    where: { ownerType, ownerId, checksum, deletedAt: null },
  });
  if (dup) {
    safeUnlink(req.file.path);
    return res.status(200).json({ success: true, message: "Identical file already attached", data: publicShape(dup) });
  }

  const storageKey = req.file.filename; // relative to uploads/ (Phase-2: swap adapter)
  const created = await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        ownerType,
        ownerId,
        otdStepId: otdStepId ?? null,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        checksum,
        storageKey,
        docType: docType ?? null,
        scanStatus: "clean", // Phase-1: no ClamAV; magic-byte/scan hook is Phase-2 (CRM_MASTER §8)
        uploadedById: req.user.id,
      },
    });
    await audit(tx, req.user.id, "document.upload", doc, { ownerType, ownerId, docType: docType ?? null, fileName: doc.fileName });
    await emitDocumentsChanged(tx, doc, { change: "upload", actorRole: req.user.role });
    return doc;
  });

  res.status(201).json({ success: true, message: "Document uploaded", data: publicShape(created) });
});

/* ── GET /api/documents?ownerType=&ownerId= ── */
export const listDocuments = catchAsync(async (req, res, next) => {
  const { ownerType, ownerId } = req.query;
  const allowed = await ownerInScope(req.user, ownerType, ownerId);
  if (!allowed) return next(new AppError("Owner not found", 404));

  const where = { ownerType, ownerId, deletedAt: null };
  if (req.user.role === "customer") where.isPublished = true; // customers see published only (§2.2)

  const docs = await prisma.document.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json({ success: true, data: docs.map(publicShape) });
});

/* ── GET /api/documents/:id/download ── (audited stream) */
export const downloadDocument = catchAsync(async (req, res, next) => {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc || doc.deletedAt) return next(new AppError("Document not found", 404));

  const allowed = await ownerInScope(req.user, doc.ownerType, doc.ownerId);
  if (!allowed || (req.user.role === "customer" && !doc.isPublished)) {
    return next(new AppError("Document not found", 404));
  }

  const abs = absPathFor(doc.storageKey);
  if (!fs.existsSync(abs)) return next(new AppError("Stored file is missing", 410));

  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: "document.download",
      resourceType: "document",
      resourceId: doc.id,
      correlationId: crypto.randomUUID(),
    },
  });

  res.setHeader("Content-Type", doc.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
  fs.createReadStream(abs).pipe(res);
});

/* ── POST /api/documents/:id/publish ── (manager-level, INV-10, RULE-DOC-01) */
export const publishDocument = catchAsync(async (req, res, next) => {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc || doc.deletedAt) return next(new AppError("Document not found", 404));

  const allowed = await ownerInScope(req.user, doc.ownerType, doc.ownerId, { forWrite: true });
  if (!allowed) return next(new AppError("Document not found", 404));
  if (doc.isPublished) return res.json({ success: true, message: "Already published", data: publicShape(doc) });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.document.update({
      where: { id: doc.id },
      data: { isPublished: true, publishedById: req.user.id, publishedAt: new Date() },
    });
    await audit(tx, req.user.id, "document.publish", u, { fileName: u.fileName });
    await emitDocumentsChanged(tx, u, { change: "publish", actorRole: req.user.role });
    return u;
  });

  res.json({ success: true, message: "Document published to the portal", data: publicShape(updated) });
});

/* ── DELETE /api/documents/:id ── (soft delete; RULE-DOC-04 guard) */
export const deleteDocument = catchAsync(async (req, res, next) => {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc || doc.deletedAt) return next(new AppError("Document not found", 404));

  const allowed = await ownerInScope(req.user, doc.ownerType, doc.ownerId, { forWrite: true });
  if (!allowed) return next(new AppError("Document not found", 404));

  // A locked order's paperwork is the record of what happened — it stays put.
  // (Publishing is deliberately still allowed: it only reveals an existing
  // document to the customer, it cannot alter history.)
  const locked = await shipmentLockReason(doc.ownerType, doc.ownerId, "remove its documents");
  if (locked) return next(new AppError(locked, 409));

  // A step-mandatory document cannot be deleted (RULE-DOC-04).
  if (await isStepMandatoryDoc(doc)) {
    return next(new AppError("This document is mandatory for a shipment step and cannot be deleted", 409));
  }

  await prisma.$transaction(async (tx) => {
    await tx.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
    await audit(tx, req.user.id, "document.delete", doc, { reason: req.body?.reason ?? null });
    await emitDocumentsChanged(tx, doc, { change: "remove", actorRole: req.user.role });
  });

  res.json({ success: true, message: "Document deleted" });
});

/* ── GET /api/documents/required/:shipmentId ── (RULE-SH-06 checklist for the UI) */
export const requiredDocsForShipment = catchAsync(async (req, res, next) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.shipmentId } });
  if (!shipment) return next(new AppError("Shipment not found", 404));
  const allowed = await ownerInScope(req.user, "shipment", shipment.id);
  if (!allowed) return next(new AppError("Shipment not found", 404));

  const byStep = await requiredDocTypesByStep(shipment.id);
  const allTypes = [...new Set([...byStep.values()].flat())];
  const present = allTypes.length
    ? await prisma.document.findMany({
        where: { ownerType: "shipment", ownerId: shipment.id, docType: { in: allTypes }, deletedAt: null },
        select: { docType: true, id: true },
      })
    : [];
  const have = new Set(present.map((d) => d.docType));

  const steps = await prisma.otdStep.findMany({
    where: { shipmentId: shipment.id },
    orderBy: { displayNo: "asc" },
    select: { displayNo: true, stepCode: true, status: true },
  });

  const checklist = steps
    .map((s) => {
      const required = byStep.get(s.stepCode) ?? [];
      return {
        displayNo: s.displayNo,
        stepCode: s.stepCode,
        status: s.status,
        required,
        missing: required.filter((t) => !have.has(t)),
      };
    })
    .filter((s) => s.required.length > 0);

  res.json({ success: true, data: { shipmentId: shipment.id, checklist } });
});
