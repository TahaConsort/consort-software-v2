import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import {
  composeOtdPath,
  composeStepActions,
  departmentsOnPath,
  isPermittedOutOfOrder,
  OTC_MILESTONES,
} from "../../utils/composition.js";
import { inferPackageFromServices, resolveCroMode } from "../../utils/servicePackage.js";
import { missingRequiredDocs } from "../document/document.service.js";
import { renderQuotationPdf } from "../../utils/quotationPdf.js";
import { maybeSettleTx } from "../otc/otc.service.js";

/**
 * Shipment shared logic (CRM_MASTER §5.8/5.9/5.10, RULE-SH/RULE-QT-07).
 *
 * These helpers run INSIDE a caller's transaction so the whole thing commits or
 * nothing does (INV-09). They are the one place that:
 *   · composes the OTD path from services at approval (RULE-SVC-01),
 *   · derives shipments.status from steps — never written directly (ADR-014, INV-02),
 *   · advances a step and emits the domain event that drives the Action Engine.
 */

const emitEvent = (tx, eventType, payload, correlationId) =>
  tx.outboxEvent.create({
    data: { eventType, payload, correlationId: correlationId ?? crypto.randomUUID() },
  });

const stepIdOf = (stepRows, stepCode) => stepRows.find((s) => s.stepCode === stepCode)?.id ?? null;

const audit = (tx, { actorId, action, resourceType, resourceId, diff, correlationId }) =>
  tx.auditLog.create({
    data: {
      actorId: actorId ?? null,
      action,
      resourceType,
      resourceId,
      diff: diff ?? undefined,
      correlationId: correlationId ?? crypto.randomUUID(),
    },
  });

/**
 * The quote-approval transaction body (RULE-QT-07, WORKFLOW §9). Materialises
 * the shipment and everything that hangs off it. Runs inside `tx`.
 *
 * @param quotation  quotation row WITH chargeLines included
 * @returns { shipment }
 */
export const createShipmentFromApproval = async (tx, { quotation, query, customer, actorId, approvalChannel }) => {
  const correlationId = crypto.randomUUID();
  // All three are FROZEN onto the shipment below (INV-14) — the path is composed once,
  // here, and never recomposed, even if the query is later edited.
  //
  // A quotation SENT before service packages shipped has no package of its own, so
  // infer one from its service snapshot rather than compose a half-path.
  const services = quotation.services;
  const servicePackage = quotation.servicePackage ?? inferPackageFromServices(services);
  const croHandledBy = resolveCroMode({ servicePackage, croHandledBy: quotation.croHandledBy });

  // Compose the OTD path from the seeded templates (single source — ADR-001).
  const templates = await tx.otdStepTemplate.findMany();
  if (templates.length === 0) {
    throw new Error("OTD step templates are not seeded — run `node prisma/seed.js` before approving quotes.");
  }
  const path = composeOtdPath(templates, { services, servicePackage, croHandledBy });

  // quotation → approved (RULE-QT-07); query → shipment_created.
  await tx.quotation.update({
    where: { id: quotation.id },
    data: {
      status: "approved",
      decidedById: actorId,
      decidedAt: new Date(),
      approvalChannel,
      rowVersion: { increment: 1 },
    },
  });
  await tx.query.update({ where: { id: query.id }, data: { status: "shipment_created" } });

  // Shipment (status = booking; DERIVED thereafter, INV-02).
  const referenceNo = await allocateRef(tx, "shipment");
  const shipment = await tx.shipment.create({
    data: {
      referenceNo,
      quotationId: quotation.id,
      queryId: query.id,
      customerId: customer.id,
      services,
      servicePackage,
      croHandledBy,
      status: "booking",
      originPort: query.originPort ?? null,
      destinationPort: query.destinationPort ?? null,
      pickupAddress: query.pickupAddress ?? null,
      deliveryAddress: query.deliveryAddress ?? null,
      incoterm: query.incoterm ?? null,
    },
  });

  // Composed OTD steps — rows exist ONLY for the composed path (INV-04, ADR-040).
  await tx.otdStep.createMany({
    data: path.map((s) => ({
      shipmentId: shipment.id,
      canonicalNo: s.canonicalNo,
      displayNo: s.displayNo,
      stepCode: s.stepCode,
      ownerDepartment: s.ownerDepartment,
    })),
  });

  // Sub-action checklists (ADR-048), composed by the SAME gates as the steps — this is
  // what gives `order_confirmed` its seven-document international pack and the shorter
  // loading-point-to-port pack from a single step. Frozen here with the path (INV-14).
  const stepRows = await tx.otdStep.findMany({ where: { shipmentId: shipment.id }, select: { id: true, stepCode: true } });
  const actionTemplates = await tx.otdStepActionTemplate.findMany();
  const actionData = stepRows.flatMap((row) =>
    composeStepActions(actionTemplates, row.stepCode, { services, servicePackage, croHandledBy })
      .map((a) => ({ otdStepId: row.id, ...a })),
  );
  if (actionData.length) await tx.otdStepAction.createMany({ data: actionData });

  // The approved quotation, rendered and attached as a real shipment document so the
  // "Quotation" item on the order-confirmation pack is satisfied on arrival rather than
  // asked of the customer. Best-effort by design: a rendering failure must not roll back
  // an approval, and the item stays satisfiable by a manual upload of the same docType.
  if (actionData.some((a) => a.docType === "quotation")) {
    try {
      const file = await renderQuotationPdf({ quotation, query, customer, shipmentRef: referenceNo });
      if (file) {
        await tx.document.create({
          data: {
            ownerType: "shipment",
            ownerId: shipment.id,
            otdStepId: stepIdOf(stepRows, "order_confirmed"),
            ...file,
            docType: "quotation",
            scanStatus: "clean", // generated by us — never touched an upload path
            uploadedById: actorId,
          },
        });
      }
    } catch (err) {
      console.error(`[shipment ${referenceNo}] quotation PDF generation failed — upload it manually:`, err.message);
    }
  }

  // Five OTC milestones (WORKFLOW §5.3). Milestones 1 (invoice issued) and 2
  // (payment received) mirror the receivable total for display (ADR-006).
  const receivableTotal = quotation.totalAmount;
  await tx.otcMilestone.createMany({
    data: OTC_MILESTONES.map((m) => ({
      shipmentId: shipment.id,
      ...m,
      amount: [1, 2].includes(m.milestoneNo) ? receivableTotal : undefined,
    })),
  });

  // Shipment chat channel + members (RULE-CH-01) — the department heads whose
  // departments are on the composed path + the customer's BDO (never the
  // customer — INV-11).
  const channel = await tx.chatChannel.create({
    data: { type: "shipment", shipmentId: shipment.id, name: `Shipment ${referenceNo}` },
  });
  const onPathDepts = departmentsOnPath(path);
  const depts = await tx.department.findMany({ where: { code: { in: onPathDepts } } });
  // The approver joins UNLESS they are the portal customer — customers are never
  // members of internal chat channels (INV-11).
  const actorIsCustomer = approvalChannel === "customer_portal";
  const memberIds = new Set(
    [...depts.map((d) => d.headUserId), customer.assignedBdoId, actorIsCustomer ? null : actorId].filter(Boolean),
  );
  for (const userId of memberIds) {
    await tx.chatChannelMember.create({ data: { channelId: channel.id, userId } });
  }

  // Draft invoice auto-drafted from the approved quotation's charge lines (RULE-FI-01).
  const invoiceRef = await allocateRef(tx, "invoice");
  const invoice = await tx.invoice.create({
    data: {
      referenceNo: invoiceRef,
      shipmentId: shipment.id,
      quotationId: quotation.id,
      status: "draft",
      currency: quotation.currency,
      fxRate: quotation.fxRate ?? undefined,
      totalAmount: quotation.totalAmount,
    },
  });
  // The job-charge ledger — one receivable charge per quotation line (linked to
  // the auto-drafted invoice line) and, where the cost sheet was filled in, one
  // payable charge per line. Charges land on their default step when that step is
  // on the composed path, else job-level (null otdStepId).
  const chargeTypes = await tx.chargeType.findMany();
  const chargeTypeByCode = Object.fromEntries(chargeTypes.map((c) => [c.code, c]));
  const chargeTypeByService = {};
  for (const ct of chargeTypes) {
    if (ct.service && !chargeTypeByService[ct.service]) chargeTypeByService[ct.service] = ct;
  }
  const createdSteps = await tx.otdStep.findMany({ where: { shipmentId: shipment.id } });
  const stepIdByCode = Object.fromEntries(createdSteps.map((s) => [s.stepCode, s.id]));

  const resolveCharge = (line) => {
    // Prefer the line's explicit chargeCode; else fall back to a service default; else `other`.
    let ct = line.chargeCode ? chargeTypeByCode[line.chargeCode] : null;
    if (!ct && line.service) ct = chargeTypeByService[line.service];
    if (!ct) ct = chargeTypeByCode.other;
    const stepId = ct?.defaultStepCode ? stepIdByCode[ct.defaultStepCode] ?? null : null;
    return { chargeCode: ct?.code ?? "other", otdStepId: stepId };
  };

  // Batch the invoice lines + charges (pre-generated ids) so the approval
  // transaction stays a handful of round-trips regardless of line count.
  const invoiceLineData = [];
  const chargeData = [];
  for (const l of quotation.chargeLines ?? []) {
    const lineId = crypto.randomUUID();
    invoiceLineData.push({
      id: lineId,
      invoiceId: invoice.id,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.amount,
      sortOrder: l.sortOrder,
    });

    const resolved = resolveCharge(l);
    chargeData.push({
      shipmentId: shipment.id,
      otdStepId: resolved.otdStepId,
      chargeCode: resolved.chargeCode,
      direction: "receivable",
      description: l.description,
      currency: quotation.currency,
      fxRate: quotation.fxRate ?? undefined,
      estimatedAmount: l.amount,
      status: "estimated",
      invoiceLineId: lineId,
      quotationChargeLineId: l.id,
      createdById: actorId,
    });

    // Cost sheet → payable charge (buy side). Only when a cost was quoted.
    if (l.costAmount != null) {
      chargeData.push({
        shipmentId: shipment.id,
        otdStepId: resolved.otdStepId,
        chargeCode: resolved.chargeCode,
        direction: "payable",
        vendorId: l.costVendorId ?? null,
        description: l.description,
        currency: quotation.currency,
        fxRate: quotation.fxRate ?? undefined,
        estimatedAmount: l.costAmount,
        status: "estimated",
        quotationChargeLineId: l.id,
        createdById: actorId,
      });
    }
  }
  if (invoiceLineData.length) await tx.invoiceLine.createMany({ data: invoiceLineData });
  if (chargeData.length) await tx.shipmentCharge.createMany({ data: chargeData });

  // Audit + the two domain events (Action Engine + chat/notifications).
  await audit(tx, {
    actorId,
    action: "quotation.approve",
    resourceType: "shipment",
    resourceId: shipment.id,
    diff: { quotationId: quotation.id, services, stepCount: path.length },
    correlationId,
  });
  await emitEvent(tx, "quotation.approved", {
    shipmentId: shipment.id,
    shipmentRef: referenceNo,
    quotationId: quotation.id,
    queryId: query.id,
    customerId: customer.id,
    services,
  }, correlationId);
  await emitEvent(tx, "shipment.created", {
    shipmentId: shipment.id,
    shipmentRef: referenceNo,
    customerId: customer.id,
  }, correlationId);

  return { shipment, stepCount: path.length };
};

/**
 * Recompute `shipments.status` from the highest completed step on the composed
 * path (ADR-014). Never downgrades a settled/closed shipment. Writes status
 * history + emits shipment:updated hint on change. Runs inside `tx`.
 */
export const recomputeStatus = async (tx, shipmentId, actorId) => {
  const shipment = await tx.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment || ["settled", "closed"].includes(shipment.status)) return shipment?.status;

  const steps = await tx.otdStep.findMany({
    where: { shipmentId, status: "done" },
    orderBy: { canonicalNo: "desc" },
    take: 1,
  });

  let derived = "booking";
  if (steps.length) {
    const tpl = await tx.otdStepTemplate.findUnique({ where: { stepCode: steps[0].stepCode } });
    derived = tpl?.derivedStatus ?? "booking";
  }

  if (derived !== shipment.status) {
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: derived } });
    await tx.shipmentStatusHistory.create({
      data: { shipmentId, fromStatus: shipment.status, toStatus: derived, actorId: actorId ?? null },
    });
  }
  return derived;
};

/**
 * Complete an OTD step (RULE-SH-02/03/04/06/09/12, RULE-TK-02) inside `tx`.
 *
 * THE single gatekeeper (ADR-001): every guard lives HERE, under the advisory
 * lock, so every caller — the OTD endpoint, task completion, and any future
 * path — inherits identical protection. Callers only supply the actor context:
 *
 *   actorDeptCode  the actor's department code (RULE-SH-04)
 *   canForce       actor holds `shipment.force_override` (RULE-SH-03)
 *   forceReason    justification, required whenever a force is needed
 *
 * On success it marks the step done, recomputes the derived status, closes the
 * step's open task (RULE-TK-02 both directions), audits (incl. forceReason) and
 * emits `shipment.step.completed:<code>`.
 */
export const completeStepTx = async (tx, { shipment, step, actorId, actorDeptCode, canForce = false, forceReason }) => {
  const correlationId = crypto.randomUUID();

  // RULE-SH-07 — per-shipment advisory lock: simultaneous completions on the
  // same shipment serialise here; the lock releases at transaction end.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shipment.id}))`;

  // Everything below re-reads FRESH state under the lock — the pre-lock rows the
  // caller loaded may be stale.
  const live = await tx.shipment.findUnique({ where: { id: shipment.id } });
  if (!live) throw new AppError("Shipment not found", 404);
  if (live.exceptionState === "cancelled") {
    throw new AppError("This shipment is cancelled — its steps can no longer be completed", 409);
  }
  if (live.exceptionState === "on_hold") {
    // RULE-SH-09 — OTD writes are blocked while held.
    throw new AppError("This shipment is on hold — resume it before recording progress", 409);
  }
  if (["settled", "closed"].includes(live.status)) {
    // RULE-SH-12 — settled/closed shipments are immutable.
    throw new AppError(`This shipment is ${live.status} and can no longer change`, 409);
  }

  const steps = await tx.otdStep.findMany({ where: { shipmentId: live.id }, orderBy: { canonicalNo: "asc" } });
  const freshStep = steps.find((s) => s.id === step.id);
  if (!freshStep) throw new AppError("Step not found on this shipment's path", 404);
  if (freshStep.status === "done") throw new AppError("This step is already complete", 409);

  // RULE-SH-04 — only a member of the owning department completes the step.
  if (actorDeptCode !== freshStep.ownerDepartment) {
    throw new AppError("Only the step's owning department can complete this step", 403);
  }

  // RULE-SH-03 — sequence, with the permitted out-of-order pairs (OUT_OF_ORDER_PAIRS).
  const priorPending = steps.filter((s) => s.canonicalNo < freshStep.canonicalNo && s.status !== "done");
  let inOrder = priorPending.length === 0;
  if (!inOrder && priorPending.length === 1) {
    if (isPermittedOutOfOrder(priorPending[0].stepCode, freshStep.stepCode)) inOrder = true;
  }
  const forced = !inOrder;
  if (forced) {
    if (!canForce) {
      throw new AppError("Earlier steps are still pending — completing this one out of order needs a manager override", 403);
    }
    if (!forceReason || String(forceReason).trim().length < 3) {
      throw new AppError("A justification is required to complete this step out of order", 422);
    }
  }

  // The two "is the work actually done" gates, reported TOGETHER. They are evaluated as
  // one because a step can fail both, and telling someone about the missing document
  // only for them to discover four open checklist items on the retry is a round trip
  // nobody needs.
  //
  //   RULE-SH-06 — mandatory documents. Covers BOTH the template's requiredDocTypes and
  //                its required `document` sub-actions, which is how a package-dependent
  //                pack lives in the checklist without needing a gate of its own.
  //   RULE-SH-13 — required MANUAL sub-actions (ADR-048). Document sub-actions are
  //                deliberately absent here: they are derived from the files on record
  //                and already covered above, so a document blocks a step in exactly
  //                one place.
  const [missing, pendingActions] = await Promise.all([
    missingRequiredDocs(live, freshStep),
    tx.otdStepAction.findMany({
      where: { otdStepId: freshStep.id, kind: "manual", required: true, status: { not: "done" } },
      select: { title: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  if (missing.length || pendingActions.length) {
    const parts = [];
    if (pendingActions.length) parts.push(`checklist items still open: ${pendingActions.map((a) => a.title).join(", ")} (RULE-SH-13)`);
    if (missing.length) parts.push(`documents not attached: ${missing.join(", ")} (RULE-SH-06)`);
    throw new AppError(`This step isn't finished — ${parts.join("; ")}`, 422);
  }

  await tx.otdStep.update({
    where: { id: freshStep.id },
    data: {
      status: "done",
      completedById: actorId,
      completedAt: new Date(),
      forced,
      forceReason: forced ? String(forceReason).trim() : null,
    },
  });

  // RULE-TK-02 both directions — completing the step closes its open task too,
  // so a direct OTD completion never strands an open task into false overdues.
  await tx.task.updateMany({
    where: { otdStepId: freshStep.id, status: { in: ["queued", "open", "in_progress", "on_hold"] } },
    data: { status: "done", completedById: actorId, completedAt: new Date() },
  });

  let newStatus = await recomputeStatus(tx, live.id, actorId);
  // The money side may already be finished (invoices issued and paid while the
  // cargo was still moving). Completing the last step is then the event that
  // makes the order fully complete — so re-test the settle rule here, or the
  // shipment would sit in `delivered` forever with nothing left to trigger it.
  if (newStatus === "delivered") newStatus = await maybeSettleTx(tx, live.id, actorId);
  await tx.shipment.update({ where: { id: live.id }, data: { rowVersion: { increment: 1 } } });

  await audit(tx, {
    actorId,
    action: "shipment.step.complete",
    resourceType: "shipment",
    resourceId: live.id,
    diff: { stepCode: freshStep.stepCode, displayNo: freshStep.displayNo, forced, forceReason: forced ? forceReason : undefined },
    correlationId,
  });
  await emitEvent(tx, `shipment.step.completed:${freshStep.stepCode}`, {
    shipmentId: live.id,
    shipmentRef: live.referenceNo,
    customerId: live.customerId,
    stepCode: freshStep.stepCode,
    canonicalNo: freshStep.canonicalNo,
    displayNo: freshStep.displayNo,
    newStatus,
    completedBy: actorId,
  }, correlationId);

  return newStatus;
};

/**
 * Attach each step's sub-action checklist, with `satisfied` resolved (ADR-048).
 *
 * A `manual` action is satisfied when its own status says so. A `document` action is
 * DERIVED — satisfied by a live document of that type on the shipment, the same test
 * RULE-SH-06 applies — so it is never stored and can never disagree with the files on
 * record (the ADR-014 principle, applied one level down).
 *
 * @param steps array of OtdStep rows (must carry `id`)
 * @returns the same array with `actions` and `actionSummary` added to each step
 */
export const withStepActions = async (client, shipmentId, steps) => {
  if (!steps.length) return steps;
  const [actions, docs] = await Promise.all([
    client.otdStepAction.findMany({
      where: { otdStepId: { in: steps.map((s) => s.id) } },
      orderBy: { sortOrder: "asc" },
    }),
    client.document.findMany({
      where: { ownerType: "shipment", ownerId: shipmentId, deletedAt: null },
      select: { docType: true, id: true, fileName: true },
    }),
  ]);
  if (!actions.length) return steps.map((s) => ({ ...s, actions: [], actionSummary: null }));

  const docByType = new Map();
  for (const d of docs) if (d.docType && !docByType.has(d.docType)) docByType.set(d.docType, d);

  const byStep = new Map();
  for (const a of actions) {
    const doc = a.kind === "document" && a.docType ? docByType.get(a.docType) ?? null : null;
    const satisfied = a.kind === "document" ? !!doc : a.status === "done";
    const list = byStep.get(a.otdStepId) ?? [];
    list.push({
      actionCode: a.actionCode,
      title: a.title,
      kind: a.kind,
      docType: a.docType,
      required: a.required,
      sortOrder: a.sortOrder,
      notes: a.notes,
      satisfied,
      completedAt: a.completedAt,
      completedById: a.completedById,
      // So the UI can link straight to the evidence instead of hunting the doc list.
      documentId: doc?.id ?? null,
      documentName: doc?.fileName ?? null,
    });
    byStep.set(a.otdStepId, list);
  }

  return steps.map((s) => {
    const list = byStep.get(s.id) ?? [];
    const required = list.filter((a) => a.required);
    return {
      ...s,
      actions: list,
      actionSummary: list.length
        ? { total: list.length, done: list.filter((a) => a.satisfied).length, blocking: required.filter((a) => !a.satisfied).length }
        : null,
    };
  });
};

/** Convenience read: is a shipment currently held? (RULE-SH-09) */
export const isHeld = (shipment) => shipment.exceptionState === "on_hold";

/* ────────────────────────── The order lock (RULE-SH-12) ──────────────────────
 * An order locks the moment it is fully finished on BOTH sides: every OTD step
 * confirmed (status `delivered`) and every invoice paid — that combination is
 * what derives `settled` in otc.service.maybeSettleTx. From then on the record
 * is history, not a workspace: no steps, documents, schedule, milestones,
 * invoices or payments may change. `closed` is the same lock, filed away by
 * Management; `cancelled` locks for the opposite reason — the order died, so
 * there is nothing further to record against it.
 *
 * Every write path calls assertShipmentUnlocked so the rule is stated ONCE
 * (ADR-001) and can never drift between modules.
 * ─────────────────────────────────────────────────────────────────────────── */

/** @returns "cancelled" | "closed" | "settled" | null (null = still open) */
export const lockStateOf = (shipment) => {
  if (!shipment) return null;
  if (shipment.exceptionState === "cancelled") return "cancelled";
  if (shipment.status === "closed") return "closed";
  if (shipment.status === "settled") return "settled";
  return null;
};

const LOCK_PROSE = {
  cancelled: "This shipment was cancelled",
  settled: "This shipment is complete — every step is confirmed and every invoice is paid",
  closed: "This shipment is closed",
};

/**
 * The plain-language refusal for a locked order, or null when it is still open.
 * `action` completes "…so you can no longer <action>." — keep it specific.
 */
export const lockReason = (shipment, action = "change it") => {
  const lock = lockStateOf(shipment);
  return lock ? `${LOCK_PROSE[lock]}, so you can no longer ${action}.` : null;
};

/** Throw 409 when the order is locked. */
export const assertShipmentUnlocked = (shipment, action = "change it") => {
  const reason = lockReason(shipment, action);
  if (reason) throw new AppError(reason, 409);
};

/**
 * Payable side of the ledger is more permissive than the receivable side: vendor
 * bills (LOLO, transporter, demurrage) routinely arrive AFTER the customer has
 * paid and the order has `settled`, so payable writes stay open on a settled
 * shipment — they are blocked only once the order is `closed` (Management filed
 * it away) or `cancelled`. Receivable writes still use assertShipmentUnlocked.
 */
export const assertPayableWritable = (shipment, action = "record vendor costs") => {
  const lock = lockStateOf(shipment);
  if (lock === "closed" || lock === "cancelled") {
    throw new AppError(`${LOCK_PROSE[lock]}, so you can no longer ${action}.`, 409);
  }
};

export { emitEvent as emitShipmentEvent, audit as auditShipment };
