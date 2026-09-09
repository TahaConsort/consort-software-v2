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

      // BDO records giving the sent quote to the customer (mail/phone/WhatsApp).
      shareQuotation: (id, payload) =>
        mutate(() => quotationService.shareQuotation(id, payload), { invalidates: quoteTopics }),

      rejectQuotation: (id, reason) =>
        mutate(() => quotationService.rejectQuotation(id, reason), { invalidates: quoteTopics }),

      reviseQuotation: (id) =>
        mutate(() => quotationService.reviseQuotation(id), { invalidates: quoteTopics }),

      /**
       * RULE-QT-08 — approval requires the quotation's `rowVersion` as If-Match.
       *
       * The portal customer's own click (the only caller since ADR-056). `rowVersion`
       * is read from the live list rather than from a value the calling screen captured
       * earlier: send/revise all bump it without demanding an If-Match of their own.
       *
       * A conflict is NOT retried. The whole point of If-Match on a binding order is
       * that the customer approves the figures they were looking at; if the quote
       * changed underneath them, the list is refreshed and they are asked to look again
       * rather than having the click silently re-fired against numbers they never saw.
       */
      approveQuotation: async (id, rowVersion) => {
        const known = () => get().quotations.find((q) => q.id === id)?.rowVersion;
        try {
          return await mutate(() => quotationService.approveQuotation(id, rowVersion ?? known()), {
            invalidates: [
              TOPICS.QUOTATIONS, TOPICS.QUERIES, TOPICS.SHIPMENTS,
              TOPICS.TASKS, TOPICS.INVOICES, TOPICS.DASHBOARD,
            ],
          });
        } catch (err) {
          if (err?.status === 412 || err?.status === 428) {
            await get().refetch();
            const e = new Error("This quotation changed since you opened it — please review the updated figures and approve again");
            e.status = err.status;
            throw e;
          }
          throw err;
        }
      },
    };
  },
});
