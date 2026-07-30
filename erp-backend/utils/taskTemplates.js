/**
 * The step → TaskTemplate derivation (ADR-051) — ONE encoding, two writers.
 *
 * A composable step needs exactly one `eventCode: "otd.step"` TaskTemplate or the
 * Action Engine cannot chain its task (jobs/outboxRelay.js falls back to an
 * `action.unroutable` alert). The derivation used to live inline in prisma/seed.js;
 * now that the Workflow admin panel also creates and edits steps, both writers derive
 * from here so the seed and an admin edit can never drift.
 */

// Task-queue wording that reads better than the generic "Complete: <title>" — the
// customer-CRO/LC steps are chases, not filings.
export const TASK_TITLE_OVERRIDES = {
  cro_received_from_customer: "Obtain CRO copy from customer",
  lc_received_from_customer: "Obtain LC copy from customer",
  // `empty_return` and `import_empty_return` share a title; the task board shows both
  // to Transport and Operations respectively, so say which job each one belongs to.
  import_container_pickup: "Collect the container from the terminal",
  import_empty_return: "Return the empty container to the yard",
};

/**
 * Build the TaskTemplate data object for one step template.
 *
 * @param stepTpl    a step template row (or seed literal): { stepCode, title,
 *                   ownerDepartment, dueOffsetHours, requiredDocTypes }
 * @param actionTpls the step's SUB-ACTION templates (any superset is fine — filtered
 *                   by stepCode here)
 * @returns data for prisma.taskTemplate.create / update
 */
export const deriveTaskTemplateData = (stepTpl, actionTpls = []) => ({
  eventCode: "otd.step",
  stepCode: stepTpl.stepCode,
  title: TASK_TITLE_OVERRIDES[stepTpl.stepCode] ?? `Complete: ${stepTpl.title}`,
  description: `Submit/confirm "${stepTpl.title}" to advance the shipment.`,
  department: stepTpl.ownerDepartment,
  dueOffsetHours: stepTpl.dueOffsetHours,
  // The doc gate for a step whose pack lives in sub-actions is the union of both
  // sources (RULE-SH-06) — mirror it so the task card lists the same files.
  requiredDocTypes: [
    ...new Set([
      ...(stepTpl.requiredDocTypes ?? []),
      ...actionTpls
        .filter((a) => a.stepCode === stepTpl.stepCode && a.kind === "document" && a.required)
        .map((a) => a.docType),
    ]),
  ],
});
