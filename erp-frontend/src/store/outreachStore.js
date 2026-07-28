import { create } from "zustand";
import * as outreachService from "@/services/outreachService";

/** Outreach store (§5.5) — the touch log + the follow-ups-due feed. */
export const useOutreachStore = create((set, get) => ({
  outreach: [],
  followUps: [],
  followUpCounts: { overdue: 0, today: 0, upcoming: 0 },
  loading: false,
  error: null,
  targetFilter: "", // '' | 'lead' | 'customer'

  setTargetFilter: (target) => {
    set({ targetFilter: target });
    get().fetchOutreach();
  },

  fetchOutreach: async () => {
    set({ loading: true, error: null });
    try {
      const res = await outreachService.listOutreach(get().targetFilter || undefined);
      set({ outreach: res.data ?? [], loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to fetch outreach", loading: false });
    }
  },

  fetchFollowUps: async () => {
    try {
      const res = await outreachService.getFollowUpsDue();
      set({
        followUps: res.data ?? [],
        followUpCounts: res.counts ?? { overdue: 0, today: 0, upcoming: 0 },
      });
    } catch {
      /* follow-ups feed is best-effort */
    }
  },
}));
