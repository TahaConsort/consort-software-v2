import { create } from "zustand";
import * as leadService from "@/services/leadService";

/**
 * Lead store — list state + filters for the Lead Management module.
 * Server data only lives here as a fetch cache; mutations go through the
 * service then refresh the list so the machine's state is never guessed
 * client-side (status is the backend's to decide — WORKFLOW §2).
 */
export const useLeadStore = create((set, get) => ({
  leads: [],
  loading: false,
  error: null,
  filters: { status: "", source: "" },

  setFilter: (key, value) => {
    set((s) => ({ filters: { ...s.filters, [key]: value } }));
    get().fetchLeads();
  },

  fetchLeads: async () => {
    set({ loading: true, error: null });
    try {
      const { filters } = get();
      const res = await leadService.listLeads({
        status: filters.status || undefined,
        source: filters.source || undefined,
      });
      set({ leads: res.data ?? [], loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to fetch leads", loading: false });
    }
  },
}));
