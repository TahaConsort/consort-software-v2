import * as visitService from "@/services/visitService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Visit Plans store (ADR-043) — the list, with a status filter, plus the visit lifecycle.
 *
 * `complete` records an outreach touch and can advance the lead (RULE-VP-02), so it
 * dirties three lists. The Visits page already held leadStore and customerStore for its
 * dialogs but never refreshed either after a completion.
 */
export const useVisitStore = createResourceStore({
  name: "visits",
  topics: [TOPICS.VISITS],

  state: { visits: [] },
  filters: { status: "" },

  load: async ({ filters }) => {
    const res = await visitService.listVisits(filters.status || undefined);
    return { visits: res.data ?? [] };
  },

  actions: ({ get, mutate }) => {
    const visitTopics = [TOPICS.VISITS, TOPICS.DASHBOARD];
    // A completed or missed visit is itself a touch, and may move the lead's status.
    const touchTopics = [...visitTopics, TOPICS.OUTREACH, TOPICS.LEADS];

    return {
      fetchVisits: () => get().fetch(),

      createVisit: (payload) =>
        mutate(() => visitService.createVisit(payload), { invalidates: visitTopics }),

      completeVisit: (id, payload) =>
        mutate(() => visitService.completeVisit(id, payload), { invalidates: touchTopics }),

      noShowVisit: (id) =>
        mutate(() => visitService.noShowVisit(id), { invalidates: touchTopics }),

      cancelVisit: (id, reason) =>
        mutate(() => visitService.cancelVisit(id, reason), { invalidates: visitTopics }),

      rescheduleVisit: (id, plannedAt) =>
        mutate(() => visitService.rescheduleVisit(id, plannedAt), { invalidates: visitTopics }),
    };
  },
});
