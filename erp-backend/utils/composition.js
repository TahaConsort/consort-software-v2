/**
 * OTD composition (ADR-040, RULE-SVC-01, WORKFLOW §4a).
 *
 * The single source of the step catalog is `otd_step_templates` (seeded from
 * DATABASE §8). This module READS that table — it never re-encodes it (ADR-001).
 *
 * There are no selection gates any more. The service-package / CRO-mode / LC-mode
 * dimension was removed along with the rich Query model, so EVERY ACTIVE template
 * composes onto EVERY shipment, in canonical order. A step that should stop appearing
 * is deactivated, never deleted, so shipments composed while it was live still resolve
 * it by step code (missingRequiredDocs / recomputeStatus depend on that).
 */

/**
 * Compose the OTD path.
 *
 * @param templates all OtdStepTemplate rows
 * @returns array of { canonicalNo, displayNo, stepCode, title, ownerDepartment,
 *                     derivedStatus, requiredDocTypes } in canonical order.
 */
export const composeOtdPath = (templates) =>
  templates
    .filter((t) => t.active !== false)
    .sort((a, b) => a.canonicalNo - b.canonicalNo)
    .map((t, i) => ({
      canonicalNo: t.canonicalNo,
      displayNo: i + 1, // 1..N of the composed path (RULE-SVC-05)
      stepCode: t.stepCode,
      title: t.title,
      ownerDepartment: t.ownerDepartment,
      derivedStatus: t.derivedStatus,
      requiredDocTypes: t.requiredDocTypes ?? [],
    }));

/**
 * Compose one step's sub-action checklist (ADR-048). Every sub-action of the step
 * applies — it is already scoped by the step it hangs under.
 *
 * @param actionTemplates all OtdStepActionTemplate rows (any step)
 * @param stepCode        the step to build the checklist for
 * @returns array of { actionCode, title, kind, docType, sortOrder, required }, ordered
 */
export const composeStepActions = (actionTemplates, stepCode) =>
  actionTemplates
    .filter((a) => a.stepCode === stepCode)
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
 *
 * The `lc_received_from_customer` variant is gone: that step no longer composes.
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
