import { create } from "zustand";
import * as otdService from "@/services/otdService";

/**
 * OTD store (CRM_MASTER §5.9). The composed step path for one shipment, plus the
 * completion/reopen actions. Server state is the source of truth — every action
 * refetches (ADR-014: status is derived, so we never optimistically write it).
 */
export const useOtdStore = create((set, get) => ({
  shipmentId: null,
  steps: [],
  status: null,
  exceptionState: null,
  loading: false,
  busy: false,
  error: null,

  fetchSteps: async (shipmentId) => {
    set({ loading: true, error: null, shipmentId });
    try {
      const res = await otdService.getSteps(shipmentId);
      set({
        steps: res.data?.steps ?? [],
        status: res.data?.status ?? null,
        exceptionState: res.data?.exceptionState ?? null,
        loading: false,
      });
    } catch (err) {
      set({ error: err?.message || "Failed to load OTD path", loading: false });
    }
  },

  completeStep: async (displayNo, payload = {}) => {
    set({ busy: true });
    try {
      const res = await otdService.completeStep(get().shipmentId, displayNo, payload);
      await get().fetchSteps(get().shipmentId);
      return res;
    } finally {
      set({ busy: false });
    }
  },

  reopenStep: async (displayNo, reason) => {
    set({ busy: true });
    try {
      const res = await otdService.reopenStep(get().shipmentId, displayNo, reason);
      await get().fetchSteps(get().shipmentId);
      return res;
    } finally {
      set({ busy: false });
    }
  },
}));
