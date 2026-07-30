import * as taskService from "@/services/taskService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Task store (CRM_MASTER §5.12) — the department work queue.
 *
 * Completing a step-linked task completes the OTD step and re-derives the shipment
 * status (RULE-TK-02), which is why `complete` reaches well beyond this list. The queue
 * itself was the worse problem though: `task:assigned` was already on the wire and only
 * raised a toast, so the user was told about work that wasn't in the list they were
 * looking at. RealtimeBridge now invalidates `tasks` on that event.
 *
 * `busy` comes from the factory, so the Claim button disables during the request —
 * previously a double-click could claim twice.
 */
export const useTaskStore = createResourceStore({
  name: "tasks",
  topics: [TOPICS.TASKS],

  state: { tasks: [] },
  filters: { status: "" },

  load: async ({ filters }) => {
    const params = {};
    if (filters.status) params.status = filters.status;
    const res = await taskService.listTasks(params);
    return { tasks: res.data ?? [] };
  },

  actions: ({ get, mutate }) => ({
    fetchTasks: () => get().fetch(),

    claimTask: (id) =>
      mutate(() => taskService.claimTask(id), { invalidates: [TOPICS.TASKS, TOPICS.NOTIFICATIONS] }),

    reassignTask: (id, assigneeId) =>
      mutate(() => taskService.reassignTask(id, assigneeId), {
        invalidates: [TOPICS.TASKS, TOPICS.NOTIFICATIONS],
      }),

    /** May complete an OTD step and advance the shipment — see RULE-TK-02. */
    completeTask: (id, payload) =>
      mutate(() => taskService.completeTask(id, payload), {
        invalidates: [
          TOPICS.TASKS, TOPICS.SHIPMENT, TOPICS.SHIPMENTS,
          TOPICS.NOTIFICATIONS, TOPICS.DASHBOARD,
        ],
      }),
  }),
});
