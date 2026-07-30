import * as reportService from "@/services/reportService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Report store (CRM_MASTER §5.18) — the currently-viewed report's rows and summary.
 * The server owns all aggregation and scope; this only fetches.
 *
 * `activeKey` is part of the read identity, which fixes the skew where switching tabs
 * quickly showed report B's header above report A's rows: the key change blanks the rows
 * up front and the losing response is dropped.
 *
 * `download` gets a `busy` flag it never had — a double-click used to download twice, and
 * a failed CSV was silent.
 */
export const useReportStore = createResourceStore({
  name: "reports",
  topics: [TOPICS.REPORTS],

  state: { activeKey: "leads", rows: [], summary: null },
  filters: { from: "", to: "" },
  // The date range is applied with an explicit action on this screen too.
  refetchOnFilterChange: false,

  keyOf: ([key], state) => key ?? state.activeKey,
  clearOnKeyChange: { rows: [], summary: null },

  load: async ({ args, get, filters }) => {
    const activeKey = args[0] ?? get().activeKey;
    const res = await reportService.getReport(activeKey, filters);
    return { activeKey, rows: res.data ?? [], summary: res.summary ?? null };
  },

  actions: ({ set, get, mutate }) => ({
    /** Set the date range and read once. */
    setFilters: (filters) => {
      set({ filters: { ...get().filters, ...filters } });
      return get().fetch(get().activeKey);
    },

    download: (key) =>
      mutate(() => reportService.downloadReport(key ?? get().activeKey, get().filters), {
        refetch: false,
      }),
  }),
});
