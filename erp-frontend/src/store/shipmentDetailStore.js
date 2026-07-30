import * as shipmentService from "@/services/shipmentService";
import * as otdService from "@/services/otdService";
import * as otcService from "@/services/otcService";
import * as financeService from "@/services/financeService";
import { createResourceStore } from "@/lib/createResourceStore";
import { shipmentTopic, TOPICS } from "@/lib/topics";

/**
 * One shipment's detail aggregate — the OTD stepper screen (CRM_MASTER §5.8-5.11).
 *
 * `GET /shipments/:id` is the only read here, deliberately. It is the single response
 * that carries the fresh `rowVersion`, the step list already decorated with sub-action
 * state by `withStepActions`, the OTC milestones, the exceptions and the invoices —
 * i.e. everything `completeStepTx` and `maybeSettleTx` can change in one write. Reading
 * steps from `GET /otd/:id/steps` instead (as the retired otdStore did) would split the
 * aggregate across two endpoints and guarantee skew between the steps on screen and the
 * `rowVersion` the Complete button submits.
 *
 * Every mutation the screen can perform lives here rather than in the page, so each one
 * declares the topics it dirties. That is what stops the rest of the app — the shipments
 * list, the task queue, the invoice workspace, the dashboard — from needing a reload
 * after work is recorded here.
 *
 * P&L is fetched alongside but is management-only reporting, so a failure must not sink
 * the screen.
 */
export const useShipmentDetailStore = createResourceStore({
  name: "shipmentDetail",
  topicOf: (s) => (s.shipmentId ? [shipmentTopic(s.shipmentId)] : []),

  state: {
    shipmentId: null,
    shipment: null,
    pnl: null,
    canViewPnl: false,
  },

  keyOf: ([id]) => id ?? null,
  // A different shipment must never render the previous one's steps, not for one frame.
  clearOnKeyChange: { shipment: null, pnl: null },

  load: async ({ args }) => {
    const [id, opts = {}] = args;
    const canViewPnl = opts.canViewPnl ?? false;
    const [res, pnlRes] = await Promise.all([
      shipmentService.getShipment(id),
      canViewPnl ? shipmentService.getShipmentPnl(id).catch(() => null) : Promise.resolve(null),
    ]);
    return { shipmentId: id, shipment: res.data, pnl: pnlRes?.data ?? null, canViewPnl };
  },

  actions: ({ get, mutate }) => {
    const id = () => get().shipmentId;

    /** Completing or reopening a step re-derives the shipment status (ADR-014), can
     *  settle the order, closes the step's task and may free the next one. */
    const stepTopics = () => [
      shipmentTopic(id()),
      TOPICS.SHIPMENTS,
      TOPICS.TASKS,
      TOPICS.INVOICES,
      TOPICS.DASHBOARD,
    ];
    const lifecycleTopics = () => [shipmentTopic(id()), TOPICS.SHIPMENTS, TOPICS.TASKS, TOPICS.DASHBOARD];
    const moneyTopics = () => [shipmentTopic(id()), TOPICS.INVOICES, TOPICS.SHIPMENTS, TOPICS.DASHBOARD];

    return {
      /* ── OTD steps ─────────────────────────────────────────────────────────── */

      /**
       * RULE-SH-07 — `rowVersion` is mandatory server-side, and it is read from the live
       * store rather than a value the page captured at render, so a background refresh
       * between render and click can no longer cause a 412.
       *
       * If the server still reports a conflict, refetch and retry ONCE with the version it
       * gives us. This is the last piece of "reload the page" being removed: a colleague
       * completing a step's TASK bumps this same rowVersion without an If-Match of its own
       * (task.controllers.js), so an innocent user could be refused on their first click
       * through no fault of their own. One retry only — a second conflict is a genuine race
       * with another person, and looping would hide it.
       */
      completeStep: async (displayNo, { forceReason } = {}) => {
        const attempt = (rowVersion) =>
          mutate(
            () => otdService.completeStep(id(), displayNo, {
              rowVersion,
              ...(forceReason ? { forceReason } : {}),
            }),
            { invalidates: stepTopics() },
          );

        const known = () => get().shipment?.rowVersion;
        try {
          return await attempt(known());
        } catch (err) {
          if (err?.status !== 412 && err?.status !== 428) throw err;
          const stale = known();
          const fresh = err?.data?.rowVersion;
          await get().refetch();
          const retryWith = fresh ?? known();
          // Nothing new to try with — surface the original refusal rather than replay it.
          if (retryWith == null || retryWith === stale) throw err;
          return attempt(retryWith);
        }
      },

      reopenStep: (displayNo, reason) =>
        mutate(() => otdService.reopenStep(id(), displayNo, reason), { invalidates: stepTopics() }),

      /** Manual sub-action tick (RULE-SH-13). Changes the step's blocking count, which
       *  is what the Complete button reads — no other screen cares. */
      setStepAction: (displayNo, actionCode, done) =>
        mutate(() => otdService.setStepAction(id(), displayNo, actionCode, done), {
          invalidates: [shipmentTopic(id())],
        }),

      updateStepDetails: (displayNo, payload) =>
        mutate(() => otdService.updateStepDetails(id(), displayNo, payload), {
          invalidates: [shipmentTopic(id())],
        }),

      /* ── OTC milestones ────────────────────────────────────────────────────── */

      /** Can flip the shipment to `settled` and lock the whole order (RULE-SH-12). */
      completeMilestone: (milestoneNo, notes) =>
        mutate(() => otcService.completeMilestone(id(), milestoneNo, notes), {
          invalidates: lifecycleTopics(),
        }),

      /* ── Exception + close lifecycle ───────────────────────────────────────── */

      hold: (payload) =>
        mutate(() => shipmentService.holdShipment(id(), payload), { invalidates: lifecycleTopics() }),

      resume: (resolutionNotes) =>
        mutate(() => shipmentService.resumeShipment(id(), resolutionNotes), { invalidates: lifecycleTopics() }),

      cancel: (reason) =>
        mutate(() => shipmentService.cancelShipment(id(), reason), { invalidates: lifecycleTopics() }),

      close: () =>
        mutate(() => shipmentService.closeShipment(id()), { invalidates: lifecycleTopics() }),

      setSchedule: (payload) =>
        mutate(() => shipmentService.setSchedule(id(), payload), {
          invalidates: [shipmentTopic(id()), TOPICS.SHIPMENTS, TOPICS.TASKS],
        }),

      /* ── Money recorded from a step ────────────────────────────────────────── */
      /* Routed through here rather than straight at financeService, so the Accounts
         workspace stops being stale after an invoice is raised from a shipment.
         Issuing auto-completes OTC 1 and full payment OTC 2 (RULE-FI-02/03), which
         re-derives the shipment status — hence the shipment topic on all of them. */

      createInvoice: (payload) =>
        mutate(() => financeService.createInvoice({ ...payload, shipmentId: id() }), {
          invalidates: moneyTopics(),
        }),

      issueInvoice: (invoiceId) =>
        mutate(() => financeService.issueInvoice(invoiceId), { invalidates: moneyTopics() }),

      recordPayment: (invoiceId, payload) =>
        mutate(() => financeService.recordPayment(invoiceId, payload), { invalidates: moneyTopics() }),

      voidInvoice: (invoiceId, reason) =>
        mutate(() => financeService.voidInvoice(invoiceId, reason), { invalidates: moneyTopics() }),
    };
  },
});
