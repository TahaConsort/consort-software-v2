import * as queryService from "@/services/queryService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Query store (CRM_MASTER §5.6) — the Ops intake queue, with a status filter.
 *
 * Queries are born in two places besides this screen — LC-referral conversion and the
 * customer portal/storefront — and neither could reach this list before,
 * so new work simply did not appear until someone reloaded. They all publish `queries`
 * now, and so does quotation approval, which moves a query to `quoted`/`won`.
 */
export const useQueryStore = createResourceStore({
  name: "queries",
  topics: [TOPICS.QUERIES],

  state: { queries: [] },
  filters: { status: "", channel: "" }, // channel: bdo | bank_lc | website (tabs)

  load: async ({ filters }) => {
    const res = await queryService.listQueries({ status: filters.status, channel: filters.channel });
    return { queries: res.data ?? [] };
  },

  actions: ({ get, mutate }) => ({
    fetchQueries: () => get().fetch(),

    createQuery: (payload) =>
      mutate(() => queryService.createQuery(payload), {
        invalidates: [TOPICS.QUERIES, TOPICS.DASHBOARD],
      }),

    updateQuery: (id, payload) =>
      mutate(() => queryService.updateQuery(id, payload), {
        invalidates: [TOPICS.QUERIES, TOPICS.DASHBOARD],
      }),

    // Claiming assigns the customer, so the Customers screen moves too.
    claimQuery: (id) =>
      mutate(() => queryService.claimQuery(id), {
        invalidates: [TOPICS.QUERIES, TOPICS.CUSTOMERS],
      }),

    cancelQuery: (id, reason) =>
      mutate(() => queryService.cancelQuery(id, reason), {
        // Cancelling a query invalidates any quotation raised from it.
        invalidates: [TOPICS.QUERIES, TOPICS.QUOTATIONS, TOPICS.DASHBOARD],
      }),
  }),
});
