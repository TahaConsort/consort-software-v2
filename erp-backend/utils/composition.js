/**
 * OTD composition (ADR-040, RULE-SVC-01, WORKFLOW §4a).
 *
 * The single source of the step catalog is `otd_step_templates` (seeded from
 * DATABASE §8). This module READS that table — it never re-encodes it (ADR-001).
 *
 * The service-package / CRO-mode / LC-mode dimension was removed along with the rich
 * Query model. ONE gate survives it: the shipment KIND — and since ADR-057 that gate
 * separates only Order Lock (quotation-born shipments sign a Rate Confirmation,
 * contract-born ones do not). The roadmap's eight steps apply to both kinds. Within a
 * kind every ACTIVE template composes onto EVERY shipment, in canonical order.
 *
 * A step that should stop appearing is deactivated, never deleted, so shipments composed
 * while it was live still resolve it by step code (missingRequiredDocs / recomputeStatus
 * depend on that).
 */

/**
 * Compose the OTD path for one shipment kind.
 *
 * @param templates all OtdStepTemplate rows
 * @param kind      ShipmentKind — which path to compose. Defaults to `forwarding`, the
 *                  kind every pre-roadmap caller meant.
 * @returns array of { canonicalNo, displayNo, stepCode, title, ownerDepartment,
 *                     derivedStatus, requiredDocTypes } in canonical order.
 */
export const composeOtdPath = (templates, kind = "forwarding") =>
  templates
    // A row written before the column existed has no kinds; treat that as "both", which
    // is the column default, rather than silently dropping the step from every path.
    .filter((t) => t.active !== false && (t.appliesToKinds?.length ? t.appliesToKinds.includes(kind) : true))
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
 * @returns array of { actionCode, title, kind, docType, recordType, sortOrder, required }, ordered
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
      recordType: a.recordType ?? null,
      sortOrder: a.sortOrder,
      required: a.required,
    }));

/**
 * The registers a `record` sub-action may name (ADR-057). Closed list of two — not an
 * enum, because it is read by exactly three places (validation, derivation, the gate).
 */
export const RECORD_TYPES = ["contract", "financial_instrument"];
export const RECORD_TYPE_LABELS = {
  contract: "Trade Contract",
  financial_instrument: "Financial Instrument (active)",
};

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
