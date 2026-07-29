/**
 * One-shot backfill: restate the seeded indicative-pricing rows from USD into PKR.
 *
 * Why this is needed: the rate calculator reports DEFAULT_CURRENCY, but the amounts
 * it multiplies come from `rate_cards` rows that were seeded as USD figures. Flipping
 * the default to PKR without moving the numbers makes the PUBLIC storefront advertise
 * PKR 2,250 for a Karachi → Jebel Ali 40HC — understating the real price by ~280×.
 * `load_board_postings.indicative_rate` has exactly the same problem.
 *
 * This only touches INDICATIVE pricing. Quotations, invoices and payments are real
 * financial records carrying their own currency and fxRate captured at commit
 * (ADR-006) — converting those is a business decision, not a migration, so they are
 * deliberately left alone.
 *
 * Idempotent: only converts rows still marked USD. Safe to re-run.
 *
 *   node scripts/backfillCurrencyPkr.js            # report only
 *   node scripts/backfillCurrencyPkr.js --apply    # write
 */
import prisma from "../config/prisma.js";
import { DEFAULT_CURRENCY, USD_TO_PKR } from "../utils/currency.js";

const APPLY = process.argv.includes("--apply");

// Round to a whole currency unit — PKR is not quoted in fractions at this scale.
const toPkr = (v) => (v == null ? null : Math.round(Number(v) * USD_TO_PKR));
// Per-kg surcharges are small; keep two decimals or they collapse to a flat integer.
const toPkrPrecise = (v) => (v == null ? null : Math.round(Number(v) * USD_TO_PKR * 100) / 100);

async function run() {
  console.log(`Converting indicative pricing USD → ${DEFAULT_CURRENCY} at ${USD_TO_PKR}\n`);

  const cards = await prisma.rateCard.findMany({ where: { currency: "USD" } });
  if (cards.length === 0) {
    console.log("✓ rate_cards: nothing to convert");
  } else {
    for (const c of cards) {
      const next = {
        baseAmount: toPkr(c.baseAmount),
        perKgAmount: toPkrPrecise(c.perKgAmount),
        minAmount: toPkr(c.minAmount),
        currency: DEFAULT_CURRENCY,
      };
      const lane = `${c.originPort ?? "*"}→${c.destinationPort ?? "*"}`;
      console.log(`  ${c.service.padEnd(22)} ${lane.padEnd(14)} base ${c.baseAmount} → ${next.baseAmount}`);
      if (APPLY) await prisma.rateCard.update({ where: { id: c.id }, data: next });
    }
    console.log(`${APPLY ? "✓ converted" : "would convert"} ${cards.length} rate_cards\n`);
  }

  const postings = await prisma.loadBoardPosting.findMany({ where: { currency: "USD" } });
  if (postings.length === 0) {
    console.log("✓ load_board_postings: nothing to convert");
  } else {
    for (const p of postings) {
      const rate = toPkr(p.indicativeRate);
      console.log(`  ${p.referenceNo}  ${p.indicativeRate} → ${rate}`);
      if (APPLY) {
        await prisma.loadBoardPosting.update({
          where: { id: p.id },
          data: { indicativeRate: rate, currency: DEFAULT_CURRENCY },
        });
      }
    }
    console.log(`${APPLY ? "✓ converted" : "would convert"} ${postings.length} load_board_postings\n`);
  }

  if (!APPLY) console.log("Dry run — nothing written. Re-run with --apply.");
}

run()
  .catch((e) => { console.error("Backfill failed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
