/**
 * Add the rail charge vocabulary to `charge_types`.
 *
 *   node scripts/seedModeChargeTypes.js
 *
 * Idempotent upsert of these rows and nothing else, the same shape as
 * scripts/seedTradeChargeTypes.js. Deliberately NOT `prisma/seed.js --templates-only
 * --factory-reset`: that is the only other route to these rows, and since ADR-051 it
 * REPLACES the live step catalog with factory rows, destroying admin edits and any
 * admin-created step. Adding four charge codes is not worth that.
 *
 * These are what a quote needs before it can price a rail job at all — the
 * template in erp-frontend/src/lib/quoteTemplates.js seeds lines by charge code, and a
 * code with no row here falls back to the job level instead of landing on a step.
 */
import prisma from "../config/prisma.js";
import { CHARGE_TYPE_STEP_REMAP } from "../prisma/tradeWorkflow.js";

// Every line here is money OUT: a rail operator or terminal billing us. The trucking
// at each end of the rail leg is priced through inland_transport, which already exists.
const TYPES = [
  { code: "rail_freight", label: "Rail Freight / Haulage", service: "rail_freight", direction: "payable" },
  { code: "rail_terminal_handling", label: "Rail Terminal Handling", service: "rail_freight", direction: "payable" },
  { code: "wagon_detention", label: "Wagon Detention", service: "rail_freight", direction: "payable" },
].map((t) => ({ ...t, step: CHARGE_TYPE_STEP_REMAP[t.code] ?? null }));

async function run() {
  let created = 0;
  let updated = 0;

  for (const t of TYPES) {
    const existing = await prisma.chargeType.findUnique({ where: { code: t.code } });
    await prisma.chargeType.upsert({
      where: { code: t.code },
      // An existing row keeps its direction and step hint — those are admin-tunable.
      update: { label: t.label },
      create: {
        code: t.code,
        label: t.label,
        defaultDirection: t.direction,
        defaultStepCode: t.step,
        service: t.service,
        isActive: true,
      },
    });
    if (existing) updated += 1;
    else created += 1;
  }

  console.log(`✓ mode charge types — ${created} created, ${updated} already present (labels restated)`);
}

run()
  .catch((err) => {
    console.error("✗ failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
