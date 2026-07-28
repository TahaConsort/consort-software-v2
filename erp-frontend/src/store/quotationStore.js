import { create } from "zustand";
import * as quotationService from "@/services/quotationService";

/** Quotation store (CRM_MASTER §5.7) — list + status filter. */
export const useQuotationStore = create((set, get) => ({
  quotations: [],
  loading: false,
  error: null,
  statusFilter: "",

  setStatusFilter: (status) => {
    set({ statusFilter: status });
    get().fetchQuotations();
  },

  fetchQuotations: async () => {
    set({ loading: true, error: null });
    try {
      const params = {};
      if (get().statusFilter) params.status = get().statusFilter;
      const res = await quotationService.listQuotations(params);
      set({ quotations: res.data ?? [], loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to fetch quotations", loading: false });
    }
  },
}));
