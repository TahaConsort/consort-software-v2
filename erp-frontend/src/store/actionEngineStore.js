import { create } from "zustand";
import * as svc from "@/services/actionEngineService";

/**
 * Action Engine store (CRM_MASTER §5.12). Read-only Management views: templates,
 * the outbox event flow, and unroutable escalations.
 */
export const useActionEngineStore = create((set) => ({
  templates: [],
  outbox: [],
  outboxMeta: { pending: 0, stuck: 0 },
  unroutable: [],
  unroutableMeta: { open: 0 },
  loading: false,
  error: null,

  fetchTemplates: async () => {
    set({ loading: true, error: null });
    try {
      const res = await svc.getTemplates();
      set({ templates: res.data ?? [], loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to load templates", loading: false });
    }
  },

  fetchOutbox: async (params) => {
    set({ loading: true, error: null });
    try {
      const res = await svc.getOutbox(params);
      set({ outbox: res.data ?? [], outboxMeta: res.meta ?? { pending: 0, stuck: 0 }, loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to load outbox", loading: false });
    }
  },

  fetchUnroutable: async () => {
    set({ loading: true, error: null });
    try {
      const res = await svc.getUnroutable();
      set({ unroutable: res.data ?? [], unroutableMeta: res.meta ?? { open: 0 }, loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to load unroutable actions", loading: false });
    }
  },
}));
