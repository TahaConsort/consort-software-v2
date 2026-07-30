/**
 * Read-only check (ADR-051): the document_types table serves everything the old
 * hardcoded vocabulary served, and every template requirement resolves against it.
 *
 *   node scripts/verifyDocTypes.js
 *
 * Asserts:
 *  1. every legacy DOC_TYPES code exists with its legacy label;
 *  2. the customer-uploadable set is exactly the factory allowlist (+ any admin adds);
 *  3. every step template requiredDocType and document sub-action docType resolves.
 * Safe against the shared demo DB — findMany reads only.
 */
import prisma from "../config/prisma.js";
import { DOC_TYPES, DOC_TYPE_LABELS } from "../modules/document/document.validation.js";

const FACTORY_CUSTOMER_UPLOADABLE = ["cro", "lc", "commercial_invoice", "packing_list", "authority_letterhead"];

async function run() {
  const [rows, templates, actionTemplates] = await Promise.all([
    prisma.documentType.findMany(),
    prisma.otdStepTemplate.findMany({ select: { stepCode: true, requiredDocTypes: true } }),
    prisma.otdStepActionTemplate.findMany({ select: { stepCode: true, actionCode: true, kind: true, docType: true } }),
  ]);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const problems = [];

  for (const code of DOC_TYPES) {
    const row = byCode.get(code);
    if (!row) problems.push(`missing legacy doc type: ${code}`);
    else if (row.label !== DOC_TYPE_LABELS[code]) problems.push(`label drift on ${code}: "${row.label}" vs "${DOC_TYPE_LABELS[code]}"`);
  }

  for (const code of FACTORY_CUSTOMER_UPLOADABLE) {
    if (!byCode.get(code)?.customerUploadable) problems.push(`${code} should be customer-uploadable`);
  }

  for (const t of templates) {
    for (const d of t.requiredDocTypes ?? []) {
      if (!byCode.has(d)) problems.push(`step ${t.stepCode} requires unknown doc type ${d}`);
    }
  }
  for (const a of actionTemplates) {
    if (a.kind === "document" && a.docType && !byCode.has(a.docType)) {
      problems.push(`sub-action ${a.stepCode}/${a.actionCode} references unknown doc type ${a.docType}`);
    }
  }

  if (problems.length) {
    console.error("FAILURES:\n" + problems.map((p) => `  ✗ ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(`✓ ${rows.length} doc types; all ${DOC_TYPES.length} legacy codes present with matching labels`);
  console.log(`✓ customer-uploadable: ${rows.filter((r) => r.customerUploadable).map((r) => r.code).join(", ")}`);
  console.log(`✓ every template requirement resolves (${templates.length} steps, ${actionTemplates.length} sub-actions)`);
}

run()
  .catch((e) => {
    console.error("verifyDocTypes failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
