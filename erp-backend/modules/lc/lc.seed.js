import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import prisma from "../../config/prisma.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { UPLOAD_ROOT, ensureDir } from "../document/document.service.js";
import { readLcPdf } from "./lc.extract.js";

/**
 * The demo Letter of Credit that ships with the seed (CRM_MASTER §5.21).
 *
 * A real SWIFT MT710 advice — Linyi Trade City → National Steel Complex, USD 300,000,
 * 2500MT iron ore pellets, Karachi/Qasim → Qingdao — kept in the repo so every seeded
 * environment has the bank_lc channel populated with something you can actually read,
 * convert and quote. Without it that whole channel demos as an empty inbox.
 *
 * The referral is created with ONLY the LC number and issuing bank. Every trade field
 * is left empty deliberately: that is the state a referral is in when a bank EMAILS the
 * advice instead of posting structured JSON to the webhook, and it is what makes
 * "Read LC" in the inbox worth pressing.
 *
 * Idempotent on three axes, because it runs from both `prisma/seed.js` and the
 * standalone script: the referral is keyed by idempotencyKey, the document by checksum,
 * and the file on disk is rewritten only if it went missing (a wiped `uploads/` must not
 * leave a row pointing at nothing).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Shipped with the repo, so seeding never depends on a file outside it. */
export const DEMO_LC_PDF = path.resolve(HERE, "../../prisma/seed-assets/lc-mt710-sample.pdf");

export const DEMO_LC_KEY = "demo:lc:swift-mt710-sample";

export const seedDemoLcReferral = async ({
  pdfPath = DEMO_LC_PDF,
  db = prisma,
  log = console.log,
} = {}) => {
  if (!fs.existsSync(pdfPath)) {
    log(`⚠  demo LC skipped — no PDF at ${pdfPath}`);
    return { skipped: true };
  }

  const buf = fs.readFileSync(pdfPath);
  const { fields } = readLcPdf(buf);
  if (!fields.lcNumber) {
    log("⚠  demo LC skipped — the PDF has no readable SWIFT tags");
    return { skipped: true };
  }

  // Someone has to own the upload, and the LC inbox belongs to Operations. On a DB
  // seeded without accounts there is nobody to attribute it to, so skip rather than
  // invent a user.
  const uploader = await db.user.findFirst({
    where: { roles: { has: "ops_manager" }, isActive: true },
    select: { id: true },
  });
  if (!uploader) {
    log("⚠  demo LC skipped — no active ops_manager to attribute the upload to");
    return { skipped: true };
  }

  let referral = await db.bankLcReferral.findUnique({ where: { idempotencyKey: DEMO_LC_KEY } });
  if (!referral) {
    const referenceNo = await allocateRef(db, "lc_referral");
    referral = await db.bankLcReferral.create({
      data: {
        referenceNo,
        idempotencyKey: DEMO_LC_KEY,
        lcNumber: fields.lcNumber,
        bankName: fields.issuingBankName,
        rawPayload: {
          source: "seed",
          note: "Advice received as a PDF; no structured webhook payload.",
          fileName: path.basename(pdfPath),
        },
        status: "received",
      },
    });
  }

  const checksum = crypto.createHash("sha256").update(buf).digest("hex");
  let document = await db.document.findFirst({
    where: { ownerType: "lc_referral", ownerId: referral.id, checksum, deletedAt: null },
  });

  ensureDir();
  if (document) {
    // The row survived a wipe of `uploads/` — put the bytes back rather than leave a
    // download that 410s.
    const abs = path.join(UPLOAD_ROOT, document.storageKey);
    if (!fs.existsSync(abs)) fs.writeFileSync(abs, buf);
  } else {
    const storageKey = `${crypto.randomUUID()}.pdf`;
    fs.writeFileSync(path.join(UPLOAD_ROOT, storageKey), buf);
    document = await db.document.create({
      data: {
        ownerType: "lc_referral",
        ownerId: referral.id,
        fileName: `${referral.referenceNo}_Letter-of-Credit.pdf`,
        mimeType: "application/pdf",
        sizeBytes: buf.length,
        checksum,
        storageKey,
        docType: "lc",
        scanStatus: "clean",
        uploadedById: uploader.id,
      },
    });
  }

  log(`✓ demo LC ${referral.referenceNo} (${referral.status}) — ${fields.lcNumber}, `
    + `${fields.currency} ${Number(fields.amount ?? 0).toLocaleString()}, ${fields.commodity ?? "?"}`);

  return { referral, document, fields };
};
