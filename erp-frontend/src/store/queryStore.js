import { create } from "zustand";
import * as queryService from "@/services/queryService";

/** Query store (CRM_MASTER §5.6) — list + status filter. */
export const useQueryStore = create((set, get) => ({
  queries: [],
  loading: false,
  error: null,
  statusFilter: "",

  setStatusFilter: (status) => {
    set({ statusFilter: status });
    get().fetchQueries();
  },

  fetchQueries: async () => {
    set({ loading: true, error: null });
    try {
      const res = await queryService.listQueries(get().statusFilter || undefined);
      set({ queries: res.data ?? [], loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to fetch queries", loading: false });
    }
  },
}));
