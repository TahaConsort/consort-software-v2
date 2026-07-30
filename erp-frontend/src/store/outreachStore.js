import * as outreachService from "@/services/outreachService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Outreach store (§5.5) — the touch log and the follow-ups-due feed.
 *
 * Outreach rows are written from three places, and only one of them was this screen:
 * `leadService.logOutreach` on the lead detail page, and `visitService.completeVisit`
 * (RULE-VP-02) both create touches. Neither could refresh this list, so a touch logged
 * elsewhere was simply absent here. Both publish `outreach` now.
 *
 * The follow-ups feed is loaded alongside the log and stays best-effort — a failure there
 * must not take the log down with it.
 */
export const useOutreachStore = createResourceStore({
  name: "outreach",
  topics: [TOPICS.OUTREACH],

  state: {
    outreach: [],
    followUps: [],
    followUpCounts: { overdue: 0, today: 0, upcoming: 0 },
  },
  filters: { target: "" }, // '' | 'lead' | 'customer'

  load: async ({ filters }) => {
    const [logRes, dueRes] = await Promise.allSettled([
      outreachService.listOutreach(filters.target || undefined),
      outreachService.getFollowUpsDue(),
    ]);
    if (logRes.status === "rejected") throw logRes.reason;

    const patch = { outreach: logRes.value?.data ?? [] };
    if (dueRes.status === "fulfilled") {
      patch.followUps = dueRes.value?.data ?? [];
      patch.followUpCounts = dueRes.value?.counts ?? { overdue: 0, today: 0, upcoming: 0 };
    }
    return patch;
  },

  actions: ({ get, mutate }) => ({
    fetchOutreach: () => get().fetch(),
    // Kept for callers that only want the feed; both now arrive in one read.
    fetchFollowUps: () => get().fetch({ background: true }),

    /** Can advance a lead new → contacted, which the response reports as `advanced`. */
    createOutreach: (payload) =>
      mutate(() => outreachService.createOutreach(payload), {
        invalidates: [TOPICS.OUTREACH, TOPICS.LEADS, TOPICS.DASHBOARD],
      }),
  }),
});
