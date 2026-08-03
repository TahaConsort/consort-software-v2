/**
 * One-shot backfill: restate existing document display names to the convention new
 * uploads now follow — `SHIP-2025-00042_Bill-of-Lading.pdf`.
 *
 * Why: `documents.fileName` used to be whatever the uploader's file was called
 * (IMG_0043.pdf, scan (2).pdf, WhatsApp Image 2025-…jpeg). The upload path now names
 * a typed document after the docType LABEL that the RULE-SH-06 checklist asks for,
 * but rows written before that still read like a camera roll. This aligns them so a
 * shipment's paperwork is legible end to end.
 *
 * Scope: shipment-owned, non-deleted documents carrying a docType other than `other`.
 * Untyped and `other` rows are left exactly as they are — there is nothing to name
 * them after, and their original name is the only description they have.
 *
 * Only `fileName` moves. `storageKey` is the UUID the bytes actually live under and
 * is never touched, so nothing on disk is renamed and no download can break.
 *
 * The original name is written into an audit row (`document.rename`) per change, so
 * what the uploader handed over stays recoverable (INV-15).
 *
 * Idempotent: a row already at its target name is skipped. Safe to re-run.
 *
 *   node scripts/backfillDocumentFileNames.js            # report only
 *   node scripts/backfillDocumentFileNames.js --apply    # write
 */
import crypto from "crypto";
import prisma from "../config/prisma.js";
import { buildDocumentFileName } from "../modules/document/document.service.js";

const APPLY = process.argv.includes("--apply");

async function run() {
  const docs = await prisma.document.findMany({
    where: {
      ownerType: "shipment",
      deletedAt: null,
      docType: { not: null },
      NOT: { docType: "other" },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, ownerId: true, docType: true, fileName: true, mimeType: true },
  });

  // Shipment references in one read — one findUnique per document would be a query
  // per row on a table that grows with every upload.
  const shipments = await prisma.shipment.findMany({
    where: { id: { in: [...new Set(docs.map((d) => d.ownerId))] } },
    select: { id: true, referenceNo: true },
  });
  const refOf = new Map(shipments.map((s) => [s.id, s.referenceNo]));

  // The "_2" suffix has to be chosen against names this run has ALREADY assigned,
  // not just what is in the table — two PODs on one shipment are renamed in the same
  // pass, and reading the DB for the second would still show the first's old name.
  const assigned = new Map(); // ownerId → Set(lowercased names)
  for (const d of docs) {
    if (!assigned.has(d.ownerId)) assigned.set(d.ownerId, new Set());
  }
  for (const d of docs) assigned.get(d.ownerId).add(d.fileName?.toLowerCase());

  const changes = [];
  for (const d of docs) {
    const taken = assigned.get(d.ownerId);
    taken.delete(d.fileName?.toLowerCase()); // this row's own name is not a collision

    const fileName = await buildDocumentFileName({
      ownerType: "shipment",
      ownerId: d.ownerId,
      docType: d.docType,
      originalName: d.fileName,
      mimeType: d.mimeType,
      shipmentRef: refOf.get(d.ownerId),
      // The helper reads live rows; feed it a view that also knows about the names
      // this run has handed out, so a same-type pair does not collapse onto one name.
      db: {
        document: {
          findMany: async () => [...taken].map((fileName) => ({ fileName })),
        },
        shipment: prisma.shipment,
      },
    });

    taken.add(fileName.toLowerCase());
    if (fileName !== d.fileName) changes.push({ ...d, newName: fileName, ref: refOf.get(d.ownerId) });
  }

  console.log(`${docs.length} typed shipment document(s) scanned — ${changes.length} to rename.`);
  for (const c of changes) {
    console.log(`  ${c.ref ?? c.ownerId}  ${c.fileName}  →  ${c.newName}`);
  }

  if (!changes.length) return;
  if (!APPLY) {
    console.log("\nReport only. Re-run with --apply to write.");
    return;
  }

  for (const c of changes) {
    await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: c.id }, data: { fileName: c.newName } });
      await tx.auditLog.create({
        data: {
          actorId: null, // migration, not a person
          action: "document.rename",
          resourceType: "document",
          resourceId: c.id,
          diff: { from: c.fileName, to: c.newName, reason: "backfillDocumentFileNames" },
          correlationId: crypto.randomUUID(),
        },
      });
    });
  }
  console.log(`\nRenamed ${changes.length} document(s).`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
