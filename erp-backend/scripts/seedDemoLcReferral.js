/**
 * Put the demo SWIFT LC advice into the Bank LC inbox.
 *
 *   node scripts/seedDemoLcReferral.js [path/to/lc.pdf]
 *
 * Identical to `node prisma/seed.js --lc-only`, kept as a script because that is the
 * form you reach for when the rest of the seed must not be touched. Both call the same
 * insert-if-absent routine in modules/lc/lc.seed.js — running either twice, or both,
 * creates nothing extra.
 *
 * Defaults to the advice shipped with the repo (prisma/seed-assets/lc-mt710-sample.pdf):
 * MT710 advising an irrevocable credit — Linyi Trade City → National Steel Complex,
 * USD 300,000, 2500MT iron ore pellets, Karachi/Qasim → Qingdao. Pass a path to seed a
 * different one.
 */
import path from "path";
import prisma from "../config/prisma.js";
import { seedDemoLcReferral, DEMO_LC_PDF } from "../modules/lc/lc.seed.js";

const pdfPath = process.argv[2] ? path.resolve(process.argv[2]) : DEMO_LC_PDF;

seedDemoLcReferral({ pdfPath })
  .then((res) => {
    if (res.skipped) process.exitCode = 1;
    else console.log("\nOpen Admin → LC Inbox (ops_manager or ops_exec) — the referral is under 'received'.");
  })
  .catch((err) => {
    console.error("✗ failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
