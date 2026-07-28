import { create } from "zustand";
import * as dashboardService from "@/services/dashboardService";

/** Dashboard store (§5.17) — the role-aware payload. */
export const useDashboardStore = create((set) => ({
  data: null,
  loading: false,
  error: null,

  fetchDashboard: async () => {
    set({ loading: true, error: null });
    try {
      const res = await dashboardService.getDashboard();
      set({ data: res.data ?? null, loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to load dashboard", loading: false });
    }
  },
}));
