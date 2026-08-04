import * as rfqService from "@/services/rfqService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Vendor RFQ store — the rate-request board.
 *
 * Every write also invalidates QUERIES: the queries list carries a per-query
 * "vendor rates in" chip, so an RFQ that moves here leaves that screen stale.
 */
export const useRfqStore = createResourceStore({
  name: "rfqs",
  topics: [TOPICS.RFQS],

  state: { rfqs: [] },
  filters: { queryId: "", status: "" },

  load: async ({ filters }) => {
    const params = {};
    if (filters.queryId) params.queryId = filters.queryId;
    if (filters.status) params.status = filters.status;
    const res = await rfqService.listRfqs(params);
    return { rfqs: res.data ?? [] };
  },

  actions: ({ get, mutate }) => {
    const rfqTopics = [TOPICS.RFQS, TOPICS.QUERIES];

    return {
      fetchRfqs: () => get().fetch(),

      createRfqs: (payload) => mutate(() => rfqService.createRfqs(payload), { invalidates: rfqTopics }),

      addVendors: (id, vendorIds) =>
        mutate(() => rfqService.addVendors(id, vendorIds), { invalidates: rfqTopics }),

      enterQuote: (id, quoteId, payload) =>
        mutate(() => rfqService.enterQuote(id, quoteId, payload), { invalidates: rfqTopics }),

      declineQuote: (id, quoteId) =>
        mutate(() => rfqService.declineQuote(id, quoteId), { invalidates: rfqTopics }),

      // An award decides what the job costs, so the dashboard's margin view moves too.
      selectQuote: (id, quoteId) =>
        mutate(() => rfqService.selectQuote(id, quoteId), {
          invalidates: [...rfqTopics, TOPICS.DASHBOARD],
        }),

      cancelRfq: (id, reason) => mutate(() => rfqService.cancelRfq(id, reason), { invalidates: rfqTopics }),
    };
  },
});
