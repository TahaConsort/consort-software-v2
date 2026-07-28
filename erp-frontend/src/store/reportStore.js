import { create } from "zustand";
import * as reportService from "@/services/reportService";

/**
 * Report store (CRM_MASTER §5.18). Holds the currently-viewed report's rows +
 * summary. Server owns all aggregation and scope; the store just fetches.
 */
export const useReportStore = create((set, get) => ({
  activeKey: "leads",
  rows: [],
  summary: null,
  loading: false,
  error: null,
  filters: {}, // { from, to }

  setFilters: (filters) => set({ filters }),

  fetch: async (key) => {
    const activeKey = key ?? get().activeKey;
    set({ loading: true, error: null, activeKey });
    try {
      const res = await reportService.getReport(activeKey, get().filters);
      set({ rows: res.data ?? [], summary: res.summary ?? null, loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to load report", rows: [], summary: null, loading: false });
    }
  },

  download: (key) => reportService.downloadReport(key ?? get().activeKey, get().filters),
}));
