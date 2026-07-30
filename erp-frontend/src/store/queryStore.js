import * as queryService from "@/services/queryService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Query store (CRM_MASTER §5.6) — the Ops intake queue, with a status filter.
 *
 * Queries are born in three places besides this screen — inquiry conversion, LC-referral
 * conversion, and the customer portal — and none of them could reach this list before,
 * so new work simply did not appear until someone reloaded. They all publish `queries`
 * now, and so does quotation approval, which moves a query to `quoted`/`won`.
 */
export const useQueryStore = createResourceStore({
  name: "queries",
  topics: [TOPICS.QUERIES],

  state: { queries: [] },
  filters: { status: "" },

  load: async ({ filters }) => {
    const res = await queryService.listQueries(filters.status || undefined);
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

    cancelQuery: (id, reason) =>
      mutate(() => queryService.cancelQuery(id, reason), {
        // Cancelling a query invalidates any quotation raised from it.
        invalidates: [TOPICS.QUERIES, TOPICS.QUOTATIONS, TOPICS.DASHBOARD],
      }),
  }),
});
