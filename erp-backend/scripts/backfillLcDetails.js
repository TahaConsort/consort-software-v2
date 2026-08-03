/**
 * Backfill `queries.lc_details` (and the weight/cargo the LC states) for queries that
 * were converted from a bank LC BEFORE the snapshot existed.
 *
 *   node scripts/backfillLcDetails.js            # report what would change
 *   node scripts/backfillLcDetails.js --apply    # write it
 *
 * Re-reads the PDF still attached to each referral, so it produces exactly what a
 * conversion would produce today. Only touches queries whose `lcDetails` is null and
 * only fills `weightKg`/`cargoDescription` when they are empty — a value someone
 * edited by hand outranks anything re-read from a printout.
 */
import fs from "fs";
import crypto from "crypto";
import prisma from "../config/prisma.js";
import { absPathFor } from "../modules/document/document.service.js";
import { readLcPdf, parseQuantityKg } from "../modules/lc/lc.extract.js";

const APPLY = process.argv.includes("--apply");

async function run() {
  const referrals = await prisma.bankLcReferral.findMany({
    where: { status: "converted", convertedQueryId: { not: null } },
  });
  if (!referrals.length) {
    console.log("No converted LC referrals — nothing to backfill.");
    return;
  }

  const ports = await prisma.port.findMany({ select: { code: true, name: true } });
  const toCode = (v) => {
    if (!v) return null;
    const exact = ports.find((p) => p.code === v);
    if (exact) return exact.code;
    const up = v.toUpperCase();
    return ports.find((p) => new RegExp(`\\b${p.name.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(up))?.code ?? null;
  };

  let changed = 0;
  let skipped = 0;

  for (const r of referrals) {
    const query = await prisma.query.findUnique({ where: { id: r.convertedQueryId } });
    if (!query) { console.log(`- ${r.referenceNo}: query is gone, skipping`); skipped += 1; continue; }
    if (query.lcDetails) { console.log(`- ${r.referenceNo} → ${query.referenceNo}: already has lcDetails`); skipped += 1; continue; }

    const doc = await prisma.document.findFirst({
      where: { ownerType: "lc_referral", ownerId: r.id, deletedAt: null, mimeType: "application/pdf" },
      orderBy: { createdAt: "desc" },
    });
    const abs = doc && absPathFor(doc.storageKey);
    if (!abs || !fs.existsSync(abs)) {
      console.log(`- ${r.referenceNo} → ${query.referenceNo}: no LC PDF on file, skipping`);
      skipped += 1;
      continue;
    }

    const { fields: f } = readLcPdf(fs.readFileSync(abs));
    if (!f.tagCount) { console.log(`- ${r.referenceNo}: PDF has no readable SWIFT tags, skipping`); skipped += 1; continue; }

    const originPort = toCode(query.originPort) ?? toCode(r.originPort) ?? toCode(f.originPort);
    const destinationPort = toCode(query.destinationPort) ?? toCode(r.destinationPort) ?? toCode(f.destinationPort);
    const weightKg = query.weightKg ?? parseQuantityKg(f.quantity);
    const cargoDescription = query.cargoDescription
      || [f.commodity, f.quantity, f.priceTerm].filter(Boolean).join(" · ") || null;

    const data = {
      lcDetails: {
        ...f,
        issueDate: f.issueDate?.toISOString() ?? null,
        expiryDate: f.expiryDate?.toISOString() ?? null,
        latestShipmentDate: f.latestShipmentDate?.toISOString() ?? null,
        referralRef: r.referenceNo,
        resolvedOriginPort: originPort,
        resolvedDestinationPort: destinationPort,
        unresolvedPorts: [
          !originPort && f.originPort ? f.originPort : null,
          !destinationPort && f.destinationPort ? f.destinationPort : null,
        ].filter(Boolean),
        readAt: new Date().toISOString(),
        backfilled: true,
      },
      ...(query.originPort ? {} : originPort ? { originPort } : {}),
      ...(query.weightKg == null && weightKg != null ? { weightKg } : {}),
      ...(query.cargoDescription ? {} : cargoDescription ? { cargoDescription } : {}),
      ...(query.incoterm ? {} : f.incoterm ? { incoterm: f.incoterm } : {}),
    };

    console.log(`${APPLY ? "→" : "would update"} ${r.referenceNo} → ${query.referenceNo}: `
      + `${f.commodity ?? "?"} · ${f.currency ?? ""} ${f.amount ?? "?"}`
      + `${data.originPort ? ` · origin ${data.originPort}` : ""}`
      + `${data.weightKg ? ` · ${Number(data.weightKg).toLocaleString()} kg` : ""}`);

    if (APPLY) await prisma.query.update({ where: { id: query.id }, data });

    // The advice belongs on the query too, the way a conversion attaches it today.
    const onQuery = await prisma.document.findFirst({
      where: { ownerType: "query", ownerId: query.id, docType: "lc", deletedAt: null },
    });
    if (!onQuery && APPLY) {
      const storageKey = `${crypto.randomUUID()}.pdf`;
      fs.copyFileSync(abs, absPathFor(storageKey));
      await prisma.document.create({
        data: {
          ownerType: "query",
          ownerId: query.id,
          fileName: `${query.referenceNo}_Letter-of-Credit.pdf`,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          checksum: doc.checksum,
          storageKey,
          docType: "lc",
          scanStatus: doc.scanStatus,
          uploadedById: doc.uploadedById,
        },
      });
      console.log(`  · attached the LC to ${query.referenceNo}`);
    }
    changed += 1;
  }

  console.log(`\n${APPLY ? "updated" : "would update"} ${changed}, skipped ${skipped}`);
  if (!APPLY && changed) console.log("Re-run with --apply to write.");
}

run()
  .catch((err) => {
    console.error("✗ failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
