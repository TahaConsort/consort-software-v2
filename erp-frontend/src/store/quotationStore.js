import * as quotationService from "@/services/quotationService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Quotation store (CRM_MASTER §5.7) — the list, with a status filter, plus the
 * quotation lifecycle.
 *
 * `approve` is the widest-reaching write in the app (RULE-QT-07): it creates the
 * shipment, composes its OTD path and seeds the first tasks. It is fired from three
 * different screens — this list, the Queries page and the customer portal — and each
 * used to refresh only its own view. Approve from Queries and the Quotations list still
 * read `sent`; approve anywhere and the Shipments list had no new shipment. Hence the
 * six topics below.
 */
export const useQuotationStore = createResourceStore({
  name: "quotations",
  topics: [TOPICS.QUOTATIONS],

  state: { quotations: [] },
  filters: { status: "" },

  load: async ({ filters }) => {
    const params = {};
    if (filters.status) params.status = filters.status;
    const res = await quotationService.listQuotations(params);
    return { quotations: res.data ?? [] };
  },

  actions: ({ get, mutate }) => {
    const quoteTopics = [TOPICS.QUOTATIONS, TOPICS.QUERIES, TOPICS.DASHBOARD];

    return {
      fetchQuotations: () => get().fetch(),

      createQuotation: (payload) =>
        mutate(() => quotationService.createQuotation(payload), { invalidates: quoteTopics }),

      updateQuotation: (id, payload) =>
        mutate(() => quotationService.updateQuotation(id, payload), { invalidates: quoteTopics }),

      sendQuotation: (id) =>
        mutate(() => quotationService.sendQuotation(id), { invalidates: quoteTopics }),

      rejectQuotation: (id, reason) =>
        mutate(() => quotationService.rejectQuotation(id, reason), { invalidates: quoteTopics }),

      reviseQuotation: (id) =>
        mutate(() => quotationService.reviseQuotation(id), { invalidates: quoteTopics }),

      /**
       * RULE-QT-08 — approval requires the quotation's `rowVersion` as If-Match.
       *
       * `rowVersion` is read from the live list rather than from a value the calling
       * screen captured earlier: send/revise/reject all bump it without demanding an
       * If-Match of their own, so a snapshot taken when a dialog opened was routinely
       * stale by the time the user clicked, and the user was told to reload.
       *
       * If the server still reports a conflict, refetch once and retry with the value it
       * gives us. One retry only — a second conflict is a genuine race with another
       * person, and silently looping would hide it.
       */
      approveQuotation: async (id, rowVersion) => {
        const known = () => get().quotations.find((q) => q.id === id)?.rowVersion;
        const attempt = (version) =>
          mutate(() => quotationService.approveQuotation(id, version), {
            invalidates: [
              TOPICS.QUOTATIONS, TOPICS.QUERIES, TOPICS.SHIPMENTS,
              TOPICS.TASKS, TOPICS.INVOICES, TOPICS.DASHBOARD,
            ],
          });

        try {
          return await attempt(rowVersion ?? known());
        } catch (err) {
          const conflict = err?.status === 412 || err?.status === 428;
          if (!conflict) throw err;
          // The 412/428 body carries the current rowVersion so the client can heal
          // itself instead of asking the user to reload (see quotation.controllers.js).
          const fresh = err?.data?.rowVersion ?? err?.data?.data?.rowVersion;
          await get().refetch();
          const retryWith = fresh ?? known();
          if (retryWith == null || retryWith === (rowVersion ?? known())) throw err;
          return attempt(retryWith);
        }
      },
    };
  },
});
