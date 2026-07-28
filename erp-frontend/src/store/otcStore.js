import { create } from "zustand";
import * as otcService from "@/services/otcService";

/**
 * OTC store (CRM_MASTER §5.10). The five milestones for one shipment plus the
 * manual-completion action (3–5). Milestones 1–2 flip automatically from Finance
 * (RULE-FI-02/03); this store only records the manual ones and refetches.
 */
export const useOtcStore = create((set, get) => ({
  shipmentId: null,
  milestones: [],
  status: null,
  loading: false,
  busy: false,
  error: null,

  fetchMilestones: async (shipmentId) => {
    set({ loading: true, error: null, shipmentId });
    try {
      const res = await otcService.getMilestones(shipmentId);
      set({ milestones: res.data?.milestones ?? [], status: res.data?.status ?? null, loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to load OTC milestones", loading: false });
    }
  },

  completeMilestone: async (milestoneNo, notes) => {
    set({ busy: true });
    try {
      const res = await otcService.completeMilestone(get().shipmentId, milestoneNo, notes);
      await get().fetchMilestones(get().shipmentId);
      return res;
    } finally {
      set({ busy: false });
    }
  },
}));
