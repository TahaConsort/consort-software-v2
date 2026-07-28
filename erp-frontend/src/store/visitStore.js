import { create } from "zustand";
import * as visitService from "@/services/visitService";

/** Visit Plans store (ADR-043) — list + status filter. */
export const useVisitStore = create((set, get) => ({
  visits: [],
  loading: false,
  error: null,
  statusFilter: "",

  setStatusFilter: (status) => {
    set({ statusFilter: status });
    get().fetchVisits();
  },

  fetchVisits: async () => {
    set({ loading: true, error: null });
    try {
      const res = await visitService.listVisits(get().statusFilter || undefined);
      set({ visits: res.data ?? [], loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to fetch visits", loading: false });
    }
  },
}));
