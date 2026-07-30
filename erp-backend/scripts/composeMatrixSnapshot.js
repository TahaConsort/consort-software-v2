/**
 * Read-only harness: compose the OTD path + sub-action checklists for every
 * package × CRO-mode combo (plus service variants) and print one canonical,
 * sorted-key JSON document.
 *
 * Purpose: capture a byte-comparable snapshot BEFORE a catalog/schema change and
 * diff it after — the legacy combos must reproduce exactly (the same guarantee
 * ADR-046 demanded when packages were introduced).
 *
 *   node scripts/composeMatrixSnapshot.js > snapshot.json
 *
 * Touches nothing: findMany reads only. Safe against the shared demo DB.
 */
import prisma from "../config/prisma.js";
import { composeOtdPath, composeStepActions } from "../utils/composition.js";
import {
  SERVICE_PACKAGES,
  PACKAGE_SERVICES,
  allowedCroModes,
  allowedLcModes,
  resolveServices,
} from "../utils/servicePackage.js";

// Deterministic serialization — object keys sorted at every depth.
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])])
    );
  }
  return value;
};

/**
 * The service variants worth snapshotting per package: the bare preset, the
 * preset + lc_finance (the bank-LC shape), and for international also the
 * destination add-on — the combos that actually occur in production.
 */
const serviceVariants = (pkg) => {
  const preset = PACKAGE_SERVICES[pkg] ?? [];
  const variants = [preset, [...preset, "lc_finance"]];
  if (pkg === "international") {
    variants.push([...preset, "destination_services"]);
    variants.push([...preset, "lc_finance", "destination_services"]);
  }
  return variants;
};

async function run() {
  const [templates, actionTemplates] = await Promise.all([
    prisma.otdStepTemplate.findMany(),
    prisma.otdStepActionTemplate.findMany(),
  ]);
  if (templates.length === 0) {
    throw new Error("otd_step_templates is empty — nothing to snapshot.");
  }

  const combos = {};
  const problems = [];

  // Legacy combos FIRST, with no lcHandledBy in the key or selection — their output
  // must stay byte-identical to the pre-ADR-050 baseline. The LC combos below are
  // additive and keyed separately.
  for (const servicePackage of SERVICE_PACKAGES) {
    for (const croHandledBy of allowedCroModes(servicePackage)) {
      for (const services of serviceVariants(servicePackage)) {
        const selection = { services, servicePackage, croHandledBy };
        const path = composeOtdPath(templates, selection);
        const key = `${servicePackage}|cro:${croHandledBy}|svc:${[...services].sort().join("+")}`;

        // Invariants (RULE-SVC-05/06): a real path, contiguously renumbered,
        // reaching delivery. `delivered` may legitimately derive from more than
        // one step on the destination add-on (170 + 180) — assert ≥ 1.
        if (path.length === 0) problems.push(`${key}: EMPTY PATH`);
        path.forEach((s, i) => {
          if (s.displayNo !== i + 1) problems.push(`${key}: displayNo gap at ${s.stepCode}`);
        });
        const terminals = path.filter((s) => s.derivedStatus === "delivered").length;
        if (terminals < 1) problems.push(`${key}: no step derives 'delivered'`);

        combos[key] = {
          deliveredDerivingSteps: terminals,
          steps: path.map((s) => ({
            canonicalNo: s.canonicalNo,
            displayNo: s.displayNo,
            stepCode: s.stepCode,
            title: s.title,
            ownerDepartment: s.ownerDepartment,
            derivedStatus: s.derivedStatus,
            requiredDocTypes: [...(s.requiredDocTypes ?? [])].sort(),
            actions: composeStepActions(actionTemplates, s.stepCode, selection),
          })),
        };
      }
    }
  }

  // LC combos (ADR-050): every package × CRO × LC mode, services resolved the way the
  // query intake resolves them (consort sells lc_finance; customer only chases the copy).
  for (const servicePackage of SERVICE_PACKAGES) {
    for (const croHandledBy of allowedCroModes(servicePackage)) {
      for (const lcHandledBy of allowedLcModes(servicePackage)) {
        const withDownstream =
          servicePackage === "international" ? [[], ["destination_services"]] : [[]];
        for (const extras of withDownstream) {
          const services = resolveServices({ servicePackage, services: extras, lcHandledBy });
          const selection = { services, servicePackage, croHandledBy, lcHandledBy };
          const path = composeOtdPath(templates, selection);
          const key = `lc:${lcHandledBy}|${servicePackage}|cro:${croHandledBy}|svc:${[...services].sort().join("+")}`;

          if (path.length === 0) problems.push(`${key}: EMPTY PATH`);
          path.forEach((s, i) => {
            if (s.displayNo !== i + 1) problems.push(`${key}: displayNo gap at ${s.stepCode}`);
          });
          if (!path.some((s) => s.derivedStatus === "delivered")) problems.push(`${key}: no step derives 'delivered'`);

          // The LC pair is mutually exclusive by construction: 30 needs lc_finance
          // sold, 35 needs lcHandledBy=customer, and customer mode never sells it.
          const has30 = path.some((s) => s.stepCode === "lc_generated");
          const has35 = path.some((s) => s.stepCode === "lc_received_from_customer");
          if (lcHandledBy === "customer" && (!has35 || has30)) problems.push(`${key}: customer-LC pair wrong (30:${has30} 35:${has35})`);
          if (lcHandledBy === "consort" && (!has30 || has35)) problems.push(`${key}: consort-LC pair wrong (30:${has30} 35:${has35})`);
          if (lcHandledBy === "not_applicable" && (has30 || has35)) problems.push(`${key}: no-LC combo composed an LC step`);

          combos[key] = {
            deliveredDerivingSteps: path.filter((s) => s.derivedStatus === "delivered").length,
            steps: path.map((s) => ({
              canonicalNo: s.canonicalNo,
              displayNo: s.displayNo,
              stepCode: s.stepCode,
              title: s.title,
              ownerDepartment: s.ownerDepartment,
              derivedStatus: s.derivedStatus,
              requiredDocTypes: [...(s.requiredDocTypes ?? [])].sort(),
              actions: composeStepActions(actionTemplates, s.stepCode, selection),
            })),
          };
        }
      }
    }
  }

  if (problems.length) {
    console.error("INVARIANT FAILURES:\n" + problems.map((p) => `  ✗ ${p}`).join("\n"));
    process.exit(1);
  }

  process.stdout.write(JSON.stringify(canonical({ combos }), null, 2) + "\n");
  console.error(`✓ ${Object.keys(combos).length} combos composed, all invariants hold`);
}

run()
  .catch((e) => {
    console.error("Snapshot failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
