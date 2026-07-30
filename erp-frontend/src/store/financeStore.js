import * as financeService from "@/services/financeService";
import { createResourceStore } from "@/lib/createResourceStore";
import { PAYMENT_STATE_FILTERS } from "@/lib/catalog";
import { shipmentTopic, TOPICS } from "@/lib/topics";

/**
 * Finance store (CRM_MASTER §5.11) — the invoice list plus the invoice lifecycle for the
 * Accounts workspace.
 *
 * This store already refetched after every mutation; what it lacked was reach. Issuing an
 * invoice auto-completes OTC milestone 1 and full payment completes milestone 2
 * (RULE-FI-02/03), which re-derives the shipment's status (RULE-SH-12) — a coupling this
 * file documented in its own header but never acted on. Those topics are now declared, and
 * ShipmentDetailPage routes its invoice actions through shipmentDetailStore instead of
 * calling the service directly, so the two screens can no longer disagree.
 *
 * Note the server-side filtering gap left as-is: `listInvoices` accepts params but is
 * called without them, so the full table is fetched and filtered in JS. Worth fixing, but
 * it is a performance question rather than a correctness one, and changing the query shape
 * is a bigger change than this work.
 */
export const useFinanceStore = createResourceStore({
  name: "invoices",
  topics: [TOPICS.INVOICES],

  state: {
    invoices: [], // the current tab, after the payment-state filter
    allOfKind: [], // the same tab BEFORE that filter — the summary totals the tab, not the view
  },
  // `paymentState` is a PAYMENT_STATE_FILTERS value spanning several raw statuses,
  // not a raw invoice status. `kind` is the receivable/payable tab.
  filters: { paymentState: "", kind: "receivable" },

  load: async ({ filters }) => {
    const res = await financeService.listInvoices();
    const all = res.data ?? [];
    const ofKind = filters.kind ? all.filter((i) => (i.kind ?? "receivable") === filters.kind) : all;

    const statuses = PAYMENT_STATE_FILTERS.find((s) => s.value === filters.paymentState)?.statuses;
    const invoices = statuses ? ofKind.filter((i) => statuses.includes(i.status)) : ofKind;

    return { invoices, allOfKind: ofKind };
  },

  actions: ({ get, mutate }) => {
    /** An invoice belongs to a shipment, and issue/pay move that shipment's OTC state. */
    const moneyTopics = (invoiceId) => {
      const shipmentId = get().allOfKind.find((i) => i.id === invoiceId)?.shipmentId;
      return [
        TOPICS.INVOICES,
        TOPICS.SHIPMENTS,
        TOPICS.DASHBOARD,
        ...(shipmentId ? [shipmentTopic(shipmentId)] : []),
      ];
    };

    return {
      fetchInvoices: (opts = {}) => get().fetch(opts),
      setKindFilter: (kind) => get().setFilter("kind", kind),

      createInvoice: (payload) =>
        mutate(() => financeService.createInvoice(payload), {
          invalidates: [
            TOPICS.INVOICES, TOPICS.SHIPMENTS, TOPICS.DASHBOARD,
            ...(payload?.shipmentId ? [shipmentTopic(payload.shipmentId)] : []),
          ],
        }),

      /** RULE-FI-02 — completes OTC milestone 1. */
      issueInvoice: (id) =>
        mutate(() => financeService.issueInvoice(id), { invalidates: moneyTopics(id) }),

      /** RULE-FI-03 — a full payment completes OTC milestone 2 and can settle the order. */
      recordPayment: (id, payload) =>
        mutate(() => financeService.recordPayment(id, payload), { invalidates: moneyTopics(id) }),

      voidInvoice: (id, reason) =>
        mutate(() => financeService.voidInvoice(id, reason), { invalidates: moneyTopics(id) }),
    };
  },
});
