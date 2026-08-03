import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { docTypeLabels } from "./docTypes.cache.js";
import { docTypeLabel } from "./document.validation.js";

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

// ── display-name normalisation (the file a user sees and downloads) ───────────
/**
 * A document's `fileName` is presentation only — the bytes live under a random
 * `storageKey`. So the name people read in the panel, and the name their browser
 * saves on download, can be restated to match the document TYPE it satisfies
 * ("Bill of Lading (BOL)") instead of whatever the scanner called it (IMG_0043.pdf).
 * That is the whole point: a shipment's paperwork folder should be legible without
 * opening a single file.
 *
 * Deliberately NOT renaming the file on disk: the UUID storageKey is what makes
 * path traversal, collisions and the checksum dedup a non-issue, and none of those
 * guarantees are worth trading for a tidy `uploads/` listing nobody browses.
 */

const MIME_EXT = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/plain": ".txt",
  "text/csv": ".csv",
};

// Labels are written for humans, not filesystems — "GD / Customs Declaration",
// "EIR — Empty Container Pickup". Everything outside [A-Za-z0-9] collapses to a
// single hyphen, which also keeps the name free of anything Content-Disposition
// would have to percent-encode on download.
const slug = (value, max = 60) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");

const extensionFor = (originalName, mimeType) => {
  const raw = path.extname(String(originalName ?? "")).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(raw)) return raw;
  return MIME_EXT[mimeType] ?? "";
};

// Master-data owners whose reference number prefixes the display name, mapped to
// their Prisma delegate.
const MASTER_DATA_MODEL = { vendor: "vendor", driver: "driver", vehicle: "fleetVehicle" };

/** An untyped upload keeps its own name — there is nothing to name it after. */
const sanitizedOriginal = (originalName, mimeType) => {
  const base = String(originalName ?? "");
  const stem = slug(path.basename(base, path.extname(base)), 80);
  return `${stem || "document"}${extensionFor(originalName, mimeType)}`;
};

/**
 * The stored display name for an upload: `SHIP-2025-00042_Bill-of-Lading.pdf`.
 *
 * The shipment reference leads so a folder of downloads sorts by order; the docType
 * LABEL follows, because that is the wording the RULE-SH-06 checklist shows the
 * person who was asked for the document in the first place.
 *
 * `db` must be the caller's transaction client when the owning shipment was created
 * in that same transaction (the approval path) — an uncommitted row is invisible to
 * the default client, and the name would silently lose its prefix. `shipmentRef`
 * short-circuits that lookup entirely where the caller already holds it.
 *
 * Untyped and `other` uploads fall through to their own (sanitised) name.
 */
export const buildDocumentFileName = async ({
  ownerType,
  ownerId,
  docType,
  originalName,
  mimeType,
  shipmentRef,
  db = prisma,
}) => {
  if (!docType || docType === "other") return sanitizedOriginal(originalName, mimeType);

  const labels = await docTypeLabels();
  const label = slug(labels[docType] ?? docTypeLabel(docType));
  if (!label) return sanitizedOriginal(originalName, mimeType);

  let prefix = "";
  if (ownerType === "shipment") {
    const ref = shipmentRef
      ?? (await db.shipment.findUnique({ where: { id: ownerId }, select: { referenceNo: true } }))?.referenceNo;
    if (ref) prefix = `${slug(ref, 30)}_`;
  } else if (MASTER_DATA_MODEL[ownerType]) {
    // Same reasoning as a shipment reference: a folder of downloaded CNICs is
    // useless if every file is called CNIC.jpg. DRV-2026-00007_CNIC.jpg is not.
    const ref = (await db[MASTER_DATA_MODEL[ownerType]]
      .findUnique({ where: { id: ownerId }, select: { referenceNo: true } }))?.referenceNo;
    if (ref) prefix = `${slug(ref, 30)}_`;
  }

  const stem = `${prefix}${label}`;
  const ext = extensionFor(originalName, mimeType);

  // Second EIR, re-uploaded POD, a corrected invoice — suffix rather than collide.
  // Two simultaneous uploads of one type can still land on the same name; fileName
  // carries no unique constraint, so that is a cosmetic tie, not a lost document.
  const existing = await db.document.findMany({
    where: { ownerType, ownerId, deletedAt: null },
    select: { fileName: true },
  });
  const taken = new Set(existing.map((d) => d.fileName?.toLowerCase()));
  let name = `${stem}${ext}`;
  for (let i = 2; taken.has(name.toLowerCase()); i += 1) name = `${stem}_${i}${ext}`;
  return name;
};

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
