import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../../config/prisma.js";

/**
 * Documents shared logic (CRM_MASTER §5.13, RULE-DOC, RULE-SH-06).
 *
 * Phase-1 storage is the LOCAL disk (multer diskStorage → `uploads/`). The
 * `storageKey` is the path relative to that root, so a Phase-2 move to S3/MinIO
 * only swaps the storage adapter, not the schema. Files are internal by default
 * (INV-10); publishing is an explicit, audited act.
 *
 * This module is also the ONE place that answers "which legal documents does a
 * step need, and are they attached?" (RULE-SH-06) — read by the OTD/Task
 * completion path so a shipment cannot advance past a step whose mandatory
 * document (GD, BOL, POD …) is missing.
 */

export const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");

/** Ensure the upload root (and an owner-type subfolder) exists. */
export const ensureDir = (sub = "") => {
  const dir = path.join(UPLOAD_ROOT, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Magic-byte sniff (RULE-DOC-02) — verify the file's real signature matches the
 * declared MIME family, so a renamed executable can't masquerade as a PDF. Reads
 * only the header. Plain-text types (txt/csv) have no signature → allowed.
 */
export const sniffMatchesMime = async (absPath, mimeType) => {
  const fh = await fs.promises.open(absPath, "r");
  try {
    const buf = Buffer.alloc(12);
    await fh.read(buf, 0, 12, 0);
    const hex = buf.toString("hex");
    const ascii = buf.toString("latin1");
    const is = {
      pdf: ascii.startsWith("%PDF"),
      png: hex.startsWith("89504e47"),
      jpg: hex.startsWith("ffd8ff"),
      webp: ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP",
      zip: hex.startsWith("504b0304") || hex.startsWith("504b0506"), // docx/xlsx (OOXML)
      ole: hex.startsWith("d0cf11e0"), // legacy doc/xls
    };
    switch (mimeType) {
      case "application/pdf": return is.pdf;
      case "image/png": return is.png;
      case "image/jpeg": return is.jpg;
      case "image/webp": return is.webp;
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return is.zip;
      case "application/msword":
      case "application/vnd.ms-excel":
        return is.ole;
      case "text/plain":
      case "text/csv":
        return true; // no reliable signature
      default:
        return false;
    }
  } finally {
    await fh.close();
  }
};

/** SHA-256 of a file on disk — checksum dedup (RULE-DOC-02). */
export const checksumFile = (absPath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(absPath);
    stream.on("error", reject);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
  });

/** Absolute path for a stored key. */
export const absPathFor = (storageKey) => path.join(UPLOAD_ROOT, storageKey);

/** Best-effort unlink (used on rollback / dedup discard). */
export const safeUnlink = (absPath) => {
  fs.promises.unlink(absPath).catch(() => {});
};

/**
 * The mandatory doc types for each composed step of a shipment (RULE-SH-06),
 * read from the seeded `otd_step_templates` — never hard-coded (ADR-001).
 * @returns Map<stepCode, string[]>
 */
export const requiredDocTypesByStep = async (shipmentId) => {
  const steps = await prisma.otdStep.findMany({
    where: { shipmentId },
    select: {
      stepCode: true,
      // Document sub-actions are part of the SAME gate (ADR-048) — a pack that lives in
      // the checklist must still block the step, or `order_confirmed` would gate on
      // nothing now that its requiredDocTypes are empty.
      actions: { where: { kind: "document", required: true }, select: { docType: true } },
    },
  });
  const codes = steps.map((s) => s.stepCode);
  const templates = await prisma.otdStepTemplate.findMany({
    where: { stepCode: { in: codes } },
    select: { stepCode: true, requiredDocTypes: true },
  });
  const fromTemplate = new Map(templates.map((t) => [t.stepCode, t.requiredDocTypes ?? []]));
  return new Map(
    steps.map((s) => [
      s.stepCode,
      [...new Set([...(fromTemplate.get(s.stepCode) ?? []), ...s.actions.map((a) => a.docType).filter(Boolean)])],
    ]),
  );
};

/**
 * The full RULE-SH-06 document requirement for ONE composed step: the template's
 * `requiredDocTypes` plus the doc types of its required `document` sub-actions.
 *
 * The two sources are a union, never a replacement, so a step can carry a fixed
 * requirement AND a package-dependent checklist without the gate drifting between them.
 */
const requiredDocTypesForStep = async (step) => {
  const [tpl, actions] = await Promise.all([
    prisma.otdStepTemplate.findUnique({
      where: { stepCode: step.stepCode },
      select: { requiredDocTypes: true },
    }),
    prisma.otdStepAction.findMany({
      where: { otdStepId: step.id, kind: "document", required: true },
      select: { docType: true },
    }),
  ]);
  return [...new Set([...(tpl?.requiredDocTypes ?? []), ...actions.map((a) => a.docType).filter(Boolean)])];
};

/**
 * Which of a step's mandatory documents are NOT yet attached to the shipment
 * (RULE-SH-06). A step with no required types always returns []. Attachment is
 * matched on a live (not soft-deleted) shipment-owned document of that docType.
 * @returns string[] of missing docType codes
 */
export const missingRequiredDocs = async (shipment, step) => {
  const required = await requiredDocTypesForStep(step);
  if (required.length === 0) return [];

  const present = await prisma.document.findMany({
    where: {
      ownerType: "shipment",
      ownerId: shipment.id,
      docType: { in: required },
      deletedAt: null,
    },
    select: { docType: true },
  });
  const have = new Set(present.map((d) => d.docType));
  return required.filter((t) => !have.has(t));
};

/**
 * Is this document mandated by a step on its owning shipment? If so it cannot be
 * deleted (RULE-DOC-04). Only relevant to shipment-owned docs with a docType.
 */
export const isStepMandatoryDoc = async (doc) => {
  if (doc.ownerType !== "shipment" || !doc.docType) return false;
  const byStep = await requiredDocTypesByStep(doc.ownerId);
  for (const types of byStep.values()) {
    if (types.includes(doc.docType)) return true;
  }
  return false;
};
