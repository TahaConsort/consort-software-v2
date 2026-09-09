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
  RECORD_TYPE_LABELS,
} from "../../utils/composition.js";
import { buildDocumentFileName, documentGateFor, requiredDocTypesForStep } from "../document/document.service.js";
import { verificationRequiredCodes } from "../document/docTypes.cache.js";
import { docTypeLabel } from "../document/document.validation.js";
import { renderQuotationPdf } from "../../utils/quotationPdf.js";
import { renderCustomerRcPdf } from "../../utils/rcPdf.js";
import { maybeSettleTx } from "../otc/otc.service.js";
import { hasRole, isManagement } from "../auth/auth.middleware.js";

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

/**
 * Seed the party list from what the registers already name (roadmap §2/§3), so the desk
 * starts with the customer, the vendor, the bank and the buyer filled in rather than
 * blank. Roles are per shipment from this point on. Insert-if-absent on (role, party),
 * so calling it again when a contract or instrument is linked later adds only what is
 * new. Runs inside `tx`.
 */
export const seedShipmentParties = async (tx, shipment, { contract, financialInstrument, customer }) => {
  const rows = [];
  if (customer) rows.push({ role: "customer", customerId: customer.id });
  if (contract?.vendorId) rows.push({ role: "vendor", vendorId: contract.vendorId });
  if (financialInstrument?.bankVendorId) rows.push({ role: "bank", vendorId: financialInstrument.bankVendorId });
  if (financialInstrument?.buyerVendorId) rows.push({ role: "buyer", vendorId: financialInstrument.buyerVendorId });

  let added = 0;
  for (const p of rows) {
    const exists = await tx.shipmentParty.findFirst({
      where: { shipmentId: shipment.id, role: p.role, vendorId: p.vendorId ?? null, customerId: p.customerId ?? null },
      select: { id: true },
    });
    if (exists) continue;
    await tx.shipmentParty.create({
      data: { shipmentId: shipment.id, role: p.role, vendorId: p.vendorId ?? null, customerId: p.customerId ?? null },
    });
    added += 1;
  }
  return added;
};

/**
 * Is a `record` sub-action satisfied on this shipment (ADR-057)? Derived, never stored:
 * the contract register is satisfied by a linked contract, the instrument register by a
 * linked instrument that is still ACTIVE — an expired or cancelled one cannot back an
 * order, and a closed one belongs to a finished one.
 */
export const recordSatisfaction = (shipment, financialInstrument) => ({
  contract: {
    satisfied: !!shipment.contractId,
    ref: shipment.contract?.referenceNo ?? null,
    detail: shipment.contract?.contractNo ?? null,
  },
  financial_instrument: {
    satisfied: !!shipment.financialInstrumentId && financialInstrument?.status === "active",
    ref: financialInstrument?.referenceNo ?? null,
    detail: financialInstrument
      ? `${financialInstrument.fiNumber}${financialInstrument.status !== "active" ? ` (${financialInstrument.status})` : ""}`
      : null,
  },
});

/** The shipment row plus the two registers a `record` item derives from. */
const loadRegisters = (client, shipmentId) =>
  client.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      contractId: true,
      financialInstrumentId: true,
      contract: { select: { referenceNo: true, contractNo: true } },
      financialInstrument: { select: { referenceNo: true, fiNumber: true, status: true } },
    },
  });

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
 * @param actorId    who DECIDED. Null on the approval-link channel (ADR-055): the
 *                   customer decided, and no internal user may be credited with it.
 * @param authorId   who the generated PDFs are attributed to. `documents.uploaded_by_id`
 *                   is NOT nullable, so when `actorId` is null this must be supplied —
 *                   otherwise both PDFs fail inside their best-effort catch and the
 *                   shipment silently arrives with no quotation and no Rate Confirmation.
 * @returns { shipment }
 */
export const createShipmentFromApproval = async (
  tx,
  { quotation, query, customer, actorId, approvalChannel, authorId = actorId },
) => {
  const correlationId = crypto.randomUUID();
  // The service set is FROZEN onto the shipment below (INV-14). The path is composed
  // once, here, and never recomposed, even if the query is later edited.
  const services = quotation.services;

  // Compose the OTD path from the seeded templates (single source — ADR-001).
  // A quotation-born shipment is `forwarding` by kind — where it was born — which since
  // ADR-057 composes Order Lock (the customer's signed Rate Confirmation) in front of
  // the roadmap's eight steps. A contract-born shipment (createTradeShipmentTx) walks
  // the same eight without Order Lock.
  const templates = await tx.otdStepTemplate.findMany();
  if (templates.length === 0) {
    throw new Error("OTD step templates are not seeded — run `node prisma/seed.js` before approving quotes.");
  }
  const path = composeOtdPath(templates, "forwarding");

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
      status: "booking",
      // Direction is a per-shipment fact (roadmap §1). A quotation-born shipment is the
      // export cycle unless Ops says otherwise on the shipment itself.
      direction: "export",
      // The only route detail a query still carries. Ports, contacts, inland mode and
      // the import detention terms start null and are set on the shipment itself.
      pickupAddress: query.pickupAddress ?? null,
      deliveryAddress: query.destinationAddress ?? null,
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
    composeStepActions(actionTemplates, row.stepCode)
      .map((a) => ({ otdStepId: row.id, ...a })),
  );
  if (actionData.length) await tx.otdStepAction.createMany({ data: actionData });

  // The approved quotation, rendered and attached as a real shipment document — the
  // customer's accepted offer, the nearest thing to the roadmap's §4.1 proforma — and
  // hung on Step 1 (Contract & Instrument registration). Best-effort by design: a
  // rendering failure must not roll back an approval, and the file stays attachable by
  // a manual upload of the same docType.
  {
    try {
      const file = await renderQuotationPdf({ quotation, query, customer, shipmentRef: referenceNo });
      if (file) {
        // Named by the same rule as an uploaded document. `shipmentRef` is passed
        // explicitly: this shipment row is still uncommitted inside `tx` and a lookup
        // would come back empty.
        const fileName = await buildDocumentFileName({
          ownerType: "shipment",
          ownerId: shipment.id,
          docType: "quotation",
          originalName: file.fileName,
          mimeType: file.mimeType,
          shipmentRef: referenceNo,
          db: tx,
        });
        await tx.document.create({
          data: {
            ownerType: "shipment",
            ownerId: shipment.id,
            // Step 1 of the roadmap path; the retired `order_confirmed` step is the
            // fallback only for a catalog that has not been migrated yet.
            otdStepId: stepIdOf(stepRows, "trade_contract_registered") ?? stepIdOf(stepRows, "order_confirmed") ?? stepRows[0]?.id ?? null,
            ...file,
            fileName,
            docType: "quotation",
            scanStatus: "clean", // generated by us — never touched an upload path
            uploadedById: authorId,
          },
        });
      }
    } catch (err) {
      console.error(`[shipment ${referenceNo}] quotation PDF generation failed — upload it manually:`, err.message);
    }
  }

  // The customer Rate Confirmation, rendered at approval and PUBLISHED to the portal so
  // the customer can download it, sign it and upload the signed copy back. It no longer
  // satisfies the order_lock gate on its own: `rate_confirmation` requires an ops
  // verification (document_types.requires_verification), and this copy lands
  // `unverified`. Publishing is safe by construction — the customer RC carries no cost,
  // vendor or margin (utils/rcPdf.js). Best-effort, same contract as the quotation PDF
  // above: a rendering failure must never roll back an approval.
  if (actionData.some((a) => a.docType === "rate_confirmation")) {
    try {
      const file = await renderCustomerRcPdf({ quotation, query, customer, shipmentRef: referenceNo });
      if (file) {
        const fileName = await buildDocumentFileName({
          ownerType: "shipment",
          ownerId: shipment.id,
          docType: "rate_confirmation",
          originalName: file.fileName,
          mimeType: file.mimeType,
          shipmentRef: referenceNo,
          db: tx,
        });
        await tx.document.create({
          data: {
            ownerType: "shipment",
            ownerId: shipment.id,
            otdStepId: stepIdOf(stepRows, "order_lock"),
            ...file,
            fileName,
            docType: "rate_confirmation",
            scanStatus: "clean", // generated by us — never touched an upload path
            isPublished: true, // the customer has to be able to fetch it to sign it
            publishedById: authorId,
            publishedAt: new Date(),
            uploadedById: authorId,
          },
        });
      }
    } catch (err) {
      console.error(`[shipment ${referenceNo}] rate-confirmation PDF generation failed — upload it manually:`, err.message);
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

  // The customer is a party on their own shipment from birth (roadmap §2); the vendor,
  // bank and buyer follow when the contract and instrument are linked at Step 1.
  await seedShipmentParties(tx, shipment, { customer });

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
  // Batch the invoice lines (pre-generated ids) so the approval transaction stays
  // a handful of round-trips regardless of line count. The quotation's cost sheet
  // is NOT materialised here — it stays quote-side as the P&L estimate, and the
  // real cost lands as payable invoices when it is actually incurred.
  const invoiceLineData = (quotation.chargeLines ?? []).map((l) => ({
    id: crypto.randomUUID(),
    invoiceId: invoice.id,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    amount: l.amount,
    sortOrder: l.sortOrder,
  }));
  if (invoiceLineData.length) await tx.invoiceLine.createMany({ data: invoiceLineData });

  // Audit + the two domain events (Action Engine + chat/notifications).
  await audit(tx, {
    actorId,
    action: "quotation.approve",
    resourceType: "shipment",
    resourceId: shipment.id,
    // `approvalChannel` is the provenance of the whole order — which of the customer's
    // acts created this shipment (ADR-056) — so it belongs on the audit row, not only
    // on the quotation column.
    diff: { quotationId: quotation.id, approvalChannel, services, stepCount: path.length },
    correlationId,
  });
  await emitEvent(tx, "quotation.approved", {
    shipmentId: shipment.id,
    shipmentRef: referenceNo,
    quotationId: quotation.id,
    quotationRef: quotation.referenceNo,
    approvalChannel,
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

  // RULE-QT-09 — a HARD gate cannot be skipped by anyone. A pending earlier step whose
  // required documents include a type that needs Operations' verification (the signed
  // Rate Confirmation on Order Lock) is a contract gate, not a paperwork gate: it is
  // the customer's countersignature on the order, and `shipment.force_override` —
  // which every ops user holds — must not walk past it. Data-driven off
  // `document_types.requires_verification`, so it needs no template flag and covers a
  // future verified type for free.
  if (!inOrder) {
    const needsVerification = await verificationRequiredCodes();
    const hardGates = [];
    for (const s of priorPending) {
      const required = await requiredDocTypesForStep(s);
      if (required.some((t) => needsVerification.has(t))) hardGates.push(s);
    }
    if (hardGates.length) {
      const titles = await tx.otdStepTemplate.findMany({
        where: { stepCode: { in: hardGates.map((s) => s.stepCode) } },
        select: { stepCode: true, title: true },
      });
      const titleOf = (code) => titles.find((t) => t.stepCode === code)?.title ?? code;
      throw new AppError(
        `${hardGates.map((s) => titleOf(s.stepCode)).join(", ")} must be completed first — this gate cannot be overridden (RULE-QT-09)`,
        403,
      );
    }
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

  // The three "is the work actually done" gates, reported TOGETHER. They are evaluated
  // as one because a step can fail all of them, and telling someone about the missing
  // document only for them to discover four open checklist items on the retry is a
  // round trip nobody needs.
  //
  //   RULE-SH-06 — mandatory documents. Covers BOTH the template's requiredDocTypes and
  //                its required `document` sub-actions, which is how a package-dependent
  //                pack lives in the checklist without needing a gate of its own.
  //   RULE-SH-13 — required MANUAL sub-actions (ADR-048). Document sub-actions are
  //                deliberately absent here: they are derived from the files on record
  //                and already covered above, so a document blocks a step in exactly
  //                one place.
  //   ADR-057    — required RECORD sub-actions: the Trade Contract and the active
  //                Financial Instrument linked to the shipment. Derived from the
  //                registers, never stored, same as documents.
  const [gate, pendingActions, recordActions, registers] = await Promise.all([
    documentGateFor(live, freshStep),
    tx.otdStepAction.findMany({
      where: { otdStepId: freshStep.id, kind: "manual", required: true, status: { not: "done" } },
      select: { title: true },
      orderBy: { sortOrder: "asc" },
    }),
    tx.otdStepAction.findMany({
      where: { otdStepId: freshStep.id, kind: "record", required: true },
      select: { recordType: true },
    }),
    loadRegisters(tx, live.id),
  ]);
  const records = recordSatisfaction(registers, registers?.financialInstrument);
  const unlinked = recordActions
    .map((a) => a.recordType)
    .filter((t) => t && !records[t]?.satisfied);
  // The message is read by whoever owns the step, so it names the work that is
  // outstanding in their words — no rule citations, and document types spelled out
  // rather than shown as raw codes.
  if (gate.missing.length || gate.unverified.length || pendingActions.length || unlinked.length) {
    const parts = [];
    if (unlinked.length) parts.push(`registers not linked: ${unlinked.map((t) => RECORD_TYPE_LABELS[t] ?? t).join(", ")}`);
    if (pendingActions.length) parts.push(`checklist items still open: ${pendingActions.map((a) => a.title).join(", ")}`);
    if (gate.missing.length) parts.push(`documents not attached: ${gate.missing.map(docTypeLabel).join(", ")}`);
    // Attached but not signed off — a different job, for a different person, so it is
    // named separately rather than folded into "not attached".
    if (gate.unverified.length) {
      parts.push(`awaiting verification: ${gate.unverified.map(docTypeLabel).join(", ")}`);
    }
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
  const [actions, docs, templates, registers] = await Promise.all([
    client.otdStepAction.findMany({
      where: { otdStepId: { in: steps.map((s) => s.id) } },
      orderBy: { sortOrder: "asc" },
    }),
    client.document.findMany({
      where: { ownerType: "shipment", ownerId: shipmentId, deletedAt: null },
      select: { docType: true, id: true, fileName: true, verificationStatus: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    // OtdStep persists neither title nor hint — both resolve from the template by
    // stepCode at read time (ADR-051), so admin edits show on every shipment view.
    client.otdStepTemplate.findMany({
      where: { stepCode: { in: [...new Set(steps.map((s) => s.stepCode))] } },
      select: { stepCode: true, title: true, hint: true },
    }),
    // The registers a `record` item derives from (ADR-057) — one read for the page.
    loadRegisters(client, shipmentId),
  ]);
  const records = recordSatisfaction(registers ?? {}, registers?.financialInstrument);
  const tplByCode = new Map(templates.map((t) => [t.stepCode, t]));
  const decorate = (s) => ({
    ...s,
    title: tplByCode.get(s.stepCode)?.title ?? null,
    hint: tplByCode.get(s.stepCode)?.hint ?? null,
  });
  if (!actions.length) return steps.map((s) => ({ ...decorate(s), actions: [], actionSummary: null }));

  // A VERIFIED document wins over an unverified one of the same type, then the newest.
  // Without the preference the checklist would point at the auto-generated Rate
  // Confirmation rather than the signed copy the customer actually uploaded, and the
  // Verify button would sign off the wrong file.
  const needsVerification = await verificationRequiredCodes();
  const docByType = new Map();
  for (const d of docs) {
    if (!d.docType) continue;
    const held = docByType.get(d.docType);
    if (!held || (held.verificationStatus !== "verified" && d.verificationStatus === "verified")) {
      docByType.set(d.docType, d);
    }
  }

  const byStep = new Map();
  for (const a of actions) {
    const doc = a.kind === "document" && a.docType ? docByType.get(a.docType) ?? null : null;
    const mustVerify = !!a.docType && needsVerification.has(a.docType);
    const record = a.kind === "record" && a.recordType ? records[a.recordType] ?? null : null;
    const satisfied =
      a.kind === "document"
        ? !!doc && (!mustVerify || doc.verificationStatus === "verified")
        : a.kind === "record"
          ? !!record?.satisfied
          : a.status === "done";
    const list = byStep.get(a.otdStepId) ?? [];
    list.push({
      actionCode: a.actionCode,
      title: a.title,
      kind: a.kind,
      docType: a.docType,
      // A `record` item says which register and, once linked, which row — so the UI can
      // show "TCN-2026-00003 · AST/09/25/002" and offer Register when it is not there.
      recordType: a.recordType ?? null,
      recordRef: record?.ref ?? null,
      recordDetail: record?.detail ?? null,
      required: a.required,
      sortOrder: a.sortOrder,
      notes: a.notes,
      satisfied,
      completedAt: a.completedAt,
      completedById: a.completedById,
      // So the UI can link straight to the evidence instead of hunting the doc list.
      documentId: doc?.id ?? null,
      documentName: doc?.fileName ?? null,
      // Drives the Verify / Reject controls and the badge on the checklist row.
      requiresVerification: mustVerify,
      verificationStatus: doc?.verificationStatus ?? null,
    });
    byStep.set(a.otdStepId, list);
  }

  return steps.map((s) => {
    const list = byStep.get(s.id) ?? [];
    const required = list.filter((a) => a.required);
    return {
      ...decorate(s),
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

/* ──────────────────── Ops ownership of a shipment (2026-09-08) ────────────────
 * A shipment is CLAIMED by one ops person, and from then on only they run it:
 * its steps, its schedule, its parties, its trade documents, its money. Three
 * ops people no longer all write to the same job. Unclaimed is the default —
 * approval mints the shipment with no owner and the Action Engine queues the
 * first operations task instead of assigning it, so claiming is the act that
 * starts the work.
 *
 * Deliberately narrow: this binds OPS only. Compliance, Transport, Finance and
 * Management are untouched — RULE-SH-04 already confines each department to the
 * steps it owns, and blocking them here would stall a job whose ops owner is on
 * leave. Management reassigns or releases with `shipment.assign`.
 * ─────────────────────────────────────────────────────────────────────────── */

const OPS_ROLES = ["ops_manager", "ops_exec"];

/** Does this actor's authority over a shipment come from being its ops owner? */
export const isOpsActor = (user) =>
  !isManagement(user) && hasRole(user, ...OPS_ROLES);

/**
 * Throw when an ops user touches a shipment that is not theirs.
 * `action` completes "…before you <action>." / "…so you cannot <action>."
 */
export const assertOpsOwner = async (req, shipment, action = "work this shipment") => {
  if (!isOpsActor(req.user)) return;
  if (!shipment.opsOwnerId) {
    throw new AppError(`This shipment is unclaimed — claim it before you ${action}.`, 409);
  }
  if (shipment.opsOwnerId === req.user.id) return;
  const owner = await prisma.user.findUnique({
    where: { id: shipment.opsOwnerId },
    select: { email: true, employee: { select: { firstName: true, lastName: true } } },
  });
  const who = owner?.employee
    ? `${owner.employee.firstName} ${owner.employee.lastName}`
    : owner?.email ?? "another ops user";
  throw new AppError(`${who} owns this shipment, so you cannot ${action}.`, 403);
};

export { emitEvent as emitShipmentEvent, audit as auditShipment };

/**
 * Create a shipment from a Trade Contract instead of an approved quotation
 * (Export Shipment Workflow roadmap Step 1).
 *
 * This is the deliberate exception to INV-03. The roadmap cycle starts at the BRD /
 * contract and the bank registration, both of which exist before anybody quotes
 * anything, so a trade shipment has no quotation to originate from. Everything else is
 * identical to the quotation path: the OTD path is composed from the same templates,
 * the same five OTC milestones are seeded, the same chat channel is opened.
 *
 * What it deliberately does NOT do is auto-draft a receivable. On a trade shipment the
 * receivable is drafted when the SALE commercial invoice is issued (§4.4), because that
 * is the document the customer is actually billed against.
 */
export const createTradeShipmentTx = async (tx, { contract, financialInstrument, customer, body, actorId }) => {
  const correlationId = crypto.randomUUID();
  const services = body.services;

  const templates = await tx.otdStepTemplate.findMany();
  if (templates.length === 0) {
    throw new AppError("OTD step templates are not seeded — the composition catalog is empty", 500);
  }
  // The export-trade path (roadmap §5), not the forwarding one.
  const path = composeOtdPath(templates, "trade");
  if (path.length === 0) {
    throw new AppError("The workflow catalog composes no trade steps — every trade step template is inactive", 422);
  }

  const referenceNo = await allocateRef(tx, "shipment");
  const shipment = await tx.shipment.create({
    data: {
      referenceNo,
      kind: "trade",
      direction: body.direction ?? contract.direction ?? "export",
      contractId: contract.id,
      financialInstrumentId: financialInstrument?.id ?? null,
      customerId: customer.id,
      services,
      status: "booking",
      originPort: body.originPort ?? null,
      destinationPort: body.destinationPort ?? financialInstrument?.portOfDischarge ?? null,
      incoterm: body.incoterm ?? financialInstrument?.incoterm ?? contract.incoterm ?? null,
      etd: body.etd ?? null,
      eta: body.eta ?? null,
    },
  });

  await tx.otdStep.createMany({
    data: path.map((s) => ({
      shipmentId: shipment.id,
      canonicalNo: s.canonicalNo,
      displayNo: s.displayNo,
      stepCode: s.stepCode,
      ownerDepartment: s.ownerDepartment,
    })),
  });

  const stepRows = await tx.otdStep.findMany({ where: { shipmentId: shipment.id }, select: { id: true, stepCode: true } });
  const actionTemplates = await tx.otdStepActionTemplate.findMany();
  const actionData = stepRows.flatMap((row) =>
    composeStepActions(actionTemplates, row.stepCode)
      .map((a) => ({ otdStepId: row.id, ...a })),
  );
  if (actionData.length) await tx.otdStepAction.createMany({ data: actionData });

  await tx.otcMilestone.createMany({
    data: OTC_MILESTONES.map((m) => ({ shipmentId: shipment.id, ...m })),
  });

  const channel = await tx.chatChannel.create({
    data: { type: "shipment", shipmentId: shipment.id, name: `Shipment ${referenceNo}` },
  });
  const depts = await tx.department.findMany({ where: { code: { in: departmentsOnPath(path) } } });
  const memberIds = new Set([...depts.map((d) => d.headUserId), customer.assignedBdoId, actorId].filter(Boolean));
  for (const userId of memberIds) {
    await tx.chatChannelMember.create({ data: { channelId: channel.id, userId } });
  }

  // Seed the party list from what the contract and the instrument already name, so the
  // desk starts with the vendor, the bank and the buyer filled in rather than blank
  // (roadmap §2/§3). Roles are per shipment from this point on.
  await seedShipmentParties(tx, shipment, { contract, financialInstrument, customer });

  await audit(tx, {
    actorId,
    action: "shipment.created_from_contract",
    resourceType: "shipment",
    resourceId: shipment.id,
    diff: { referenceNo, contractId: contract.id, financialInstrumentId: financialInstrument?.id ?? null, services },
    correlationId,
  });
  await emitEvent(tx, "shipment.created", { shipmentId: shipment.id, referenceNo, kind: "trade" }, correlationId);

  return { shipment, stepCount: path.length };
};
