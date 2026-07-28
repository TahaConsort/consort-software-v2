import { create } from "zustand";
import * as auditService from "@/services/auditService";

/**
 * Audit store (CRM_MASTER §5.19) — Management-only filterable trail with paging.
 */
export const useAuditStore = create((set, get) => ({
  logs: [],
  meta: { page: 1, take: 50, total: 0, pages: 1 },
  facets: { resourceTypes: [], actions: [] },
  filters: { resourceType: "", action: "", actorId: "", from: "", to: "" },
  loading: false,
  error: null,

  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),

  fetchFacets: async () => {
    try {
      const res = await auditService.getFacets();
      set({ facets: res.data ?? { resourceTypes: [], actions: [] } });
    } catch { /* non-fatal */ }
  },

  fetch: async (page = 1) => {
    set({ loading: true, error: null });
    try {
      const res = await auditService.listAudit({ ...get().filters, page, take: get().meta.take });
      set({ logs: res.data ?? [], meta: res.meta ?? get().meta, loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to load audit trail", loading: false });
    }
  },
}));
