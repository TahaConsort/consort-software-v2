/**
 * Service-driven OTD composition (ADR-040, RULE-SVC-01, WORKFLOW §4a).
 *
 * The single source of the service→step mapping is `otd_step_templates`
 * (seeded from DATABASE §8). This module READS that table — it never re-encodes
 * the mapping (ADR-001). Given a shipment's selected services it returns the
 * composed, canonically-ordered, display-renumbered subset of steps.
 */

/**
 * True if the template belongs on a shipment with this selection.
 *
 * Three gates, evaluated package → CRO mode → service. A gate whose column is EMPTY
 * does not constrain; a gate whose column is SET must match:
 *
 *  1. package  — a template listing `packages` applies ONLY to those packages.
 *                Combined with `always: true` this reads "always, on these packages".
 *                Note there is deliberately no null-package escape hatch: skipping the
 *                gate would make package-only steps (the local trucking leg) apply to
 *                everything. Callers must resolve a package first — see
 *                `inferPackageFromServices` in utils/servicePackage.js.
 *  2. CRO mode — picks exactly one of the two mutually exclusive CRO template rows
 *                (`cro_received_from_customer` vs `cro_released`).
 *  3. service  — the original ADR-040 rule, unchanged.
 */
const gatesPass = (tpl, { services, servicePackage, croHandledBy }) => {
  if (tpl.packages?.length && !tpl.packages.includes(servicePackage)) return false;
  if (tpl.croModes?.length && !tpl.croModes.includes(croHandledBy)) return false;
  return true;
};

const templateApplies = (tpl, selection) => {
  // A superseded step (customs_entry / inspected_sealed, folded into customs_clearance
  // by ADR-048) keeps its row so historical shipments resolve, but never composes again.
  if (tpl.active === false) return false;
  if (!gatesPass(tpl, selection)) return false;
  return tpl.always || tpl.services.some((s) => selection.services.includes(s));
};

/**
 * Compose the OTD path for a selection.
 * @param templates all OtdStepTemplate rows
 * @param selection { services, servicePackage, croHandledBy } — `servicePackage: null`
 *                  means a pre-package shipment and disables the package gate.
 * @returns array of { canonicalNo, displayNo, stepCode, title, ownerDepartment,
 *                     derivedStatus, requiredDocTypes } in canonical order.
 */
export const composeOtdPath = (templates, { services = [], servicePackage, croHandledBy = "not_applicable" } = {}) => {
  if (!servicePackage) {
    // Composing without a package would silently drop every package-gated step and
    // produce a half-path. Callers resolve one first (inferPackageFromServices covers
    // rows created before packages existed).
    throw new Error("composeOtdPath requires a servicePackage — resolve one before composing.");
  }
  const composed = templates
    .filter((t) => templateApplies(t, { services, servicePackage, croHandledBy }))
    .sort((a, b) => a.canonicalNo - b.canonicalNo);

  return composed.map((t, i) => ({
    canonicalNo: t.canonicalNo,
    displayNo: i + 1, // 1..N of the composed path (RULE-SVC-05)
    stepCode: t.stepCode,
    title: t.title,
    ownerDepartment: t.ownerDepartment,
    derivedStatus: t.derivedStatus,
    requiredDocTypes: t.requiredDocTypes ?? [],
  }));
};

/**
 * Compose one step's sub-action checklist (ADR-048).
 *
 * Sub-actions use the SAME three gates as steps, which is what lets a single
 * `order_confirmed` step carry the seven-document international pack and the shorter
 * loading-point-to-port pack without splitting into two steps. The service gate here
 * is permissive by design — an empty `services` list means "whatever the services",
 * because a sub-action is already scoped by the step it hangs under.
 *
 * @param actionTemplates all OtdStepActionTemplate rows (any step)
 * @param stepCode        the step to build the checklist for
 * @returns array of { actionCode, title, kind, docType, sortOrder, required }, ordered
 */
export const composeStepActions = (actionTemplates, stepCode, { services = [], servicePackage, croHandledBy = "not_applicable" } = {}) =>
  actionTemplates
    .filter((a) => a.stepCode === stepCode)
    .filter((a) => gatesPass(a, { services, servicePackage, croHandledBy }))
    .filter((a) => !a.services?.length || a.services.some((s) => services.includes(s)))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((a) => ({
      actionCode: a.actionCode,
      title: a.title,
      kind: a.kind,
      docType: a.docType ?? null,
      sortOrder: a.sortOrder,
      required: a.required,
    }));

/**
 * The permitted out-of-order step pairs (RULE-SH-03): an LC advice and a vessel slot
 * booking are negotiated in parallel, so either may complete first.
 *
 * Keyed on STEP CODE, not canonical number. This was previously a hardcoded
 * `[3, 4].includes(canonicalNo)` duplicated in shipment.service.js and
 * jobs/outboxRelay.js — which silently relocates the exemption onto whatever steps
 * happen to land on 3 and 4 the moment the catalog is renumbered.
 */
export const OUT_OF_ORDER_PAIRS = [["lc_generated", "vessel_booked"]];

export const isPermittedOutOfOrder = (aCode, bCode) =>
  aCode !== bCode && OUT_OF_ORDER_PAIRS.some((p) => p.includes(aCode) && p.includes(bCode));

/**
 * Departments that own at least one step on the composed path — i.e. the
 * departments that have any role on this shipment (RULE-SVC-02).
 */
export const departmentsOnPath = (composedPath) =>
  [...new Set(composedPath.map((s) => s.ownerDepartment))];

/**
 * The five OTC milestones seeded on every shipment at approval (WORKFLOW §5.3).
 */
export const OTC_MILESTONES = [
  { milestoneNo: 1, type: "invoice_issued" },
  { milestoneNo: 2, type: "payment_received" },
  { milestoneNo: 3, type: "credit_line_released" },
  { milestoneNo: 4, type: "bol_surrendered" },
  { milestoneNo: 5, type: "settlement_complete" },
];
