import * as dashboardService from "@/services/dashboardService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Dashboard store (§5.17) — the role-aware payload.
 *
 * One call refreshes an entire screen, and almost every mutation in the app moves a
 * number on it, so nearly every store publishes `dashboard`. That is only affordable
 * because of the bus's liveness rule: when nobody is looking at a dashboard the
 * invalidation is recorded and consumed on next mount instead of issuing a request.
 *
 * It also used to raise `loading` on every refetch while leaving `data` in place, and the
 * customer portal passes `fetchDashboard` as its `onChanged` — so every action a customer
 * took flashed the whole dashboard back to a skeleton. `refreshing` replaces that.
 */
export const useDashboardStore = createResourceStore({
  name: "dashboard",
  topics: [TOPICS.DASHBOARD],

  state: { data: null },

  load: async () => {
    const res = await dashboardService.getDashboard();
    return { data: res.data ?? null };
  },

  actions: ({ get }) => ({
    fetchDashboard: (opts = {}) => get().fetch(opts),
  }),
});
