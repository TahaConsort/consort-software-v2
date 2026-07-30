import * as svc from "@/services/actionEngineService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Action Engine store (CRM_MASTER §5.12) — read-only Management views: task templates,
 * the outbox event flow, and unroutable escalations.
 *
 * The tab is the read identity. Previously all three fetches shared one `loading` flag and
 * all three ran on mount, so whichever finished first cleared the flag and revealed a
 * still-empty panel, while `error` was overwritten across the three.
 *
 * This screen shows live operational counters (pending / stuck events, open escalations)
 * with no way to know they had moved — a "stuck: 3" badge could be hours old. It now owns
 * `actionEngine`, which the relay publishes as events are dispatched.
 */
export const useActionEngineStore = createResourceStore({
  name: "actionEngine",
  topics: [TOPICS.ACTION_ENGINE],

  state: {
    tab: "templates",
    templates: [],
    outbox: [],
    outboxMeta: { pending: 0, stuck: 0 },
    unroutable: [],
    unroutableMeta: { open: 0 },
  },

  keyOf: ([tab], state) => tab ?? state.tab,

  load: async ({ args, get }) => {
    const tab = args[0] ?? get().tab;
    if (tab === "outbox") {
      const res = await svc.getOutbox(args[1]);
      return { tab, outbox: res.data ?? [], outboxMeta: res.meta ?? { pending: 0, stuck: 0 } };
    }
    if (tab === "unroutable") {
      const res = await svc.getUnroutable();
      return { tab, unroutable: res.data ?? [], unroutableMeta: res.meta ?? { open: 0 } };
    }
    const res = await svc.getTemplates();
    return { tab, templates: res.data ?? [] };
  },

  actions: ({ get }) => ({
    fetchTemplates: () => get().fetch("templates"),
    fetchOutbox: (params) => get().fetch("outbox", params),
    fetchUnroutable: () => get().fetch("unroutable"),
  }),
});
