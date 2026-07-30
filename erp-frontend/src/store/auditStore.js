import * as auditService from "@/services/auditService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Audit store (CRM_MASTER §5.19) — the Management-only filterable trail, with paging.
 *
 * Read-only: audit rows are written by whichever module performed the mutation, never
 * from here. Every mutation in the app appends to the trail, so it subscribes broadly by
 * owning `audit` and letting the relay publish it alongside whatever else changed.
 *
 * This is the one screen with an explicit Apply button, so `refetchOnFilterChange` is off:
 * refetching per keystroke across a free-text actor field and two date inputs would be a
 * request per character. `applyFilters` is the deliberate "set several, then read once"
 * entry point, which also removes the page's `setTimeout(…, 0)` hack for filters that
 * hadn't landed yet.
 */
export const useAuditStore = createResourceStore({
  name: "audit",
  topics: [TOPICS.AUDIT],

  state: {
    logs: [],
    meta: { page: 1, take: 50, total: 0, pages: 1 },
    facets: { resourceTypes: [], actions: [] },
  },
  filters: { resourceType: "", action: "", actorId: "", from: "", to: "" },
  refetchOnFilterChange: false,

  // The page is part of the identity, so paging counts as a new read rather than a
  // background refresh of the page you were already on.
  keyOf: ([page = 1]) => `page:${page}`,

  load: async ({ args, get, filters }) => {
    const [page = 1] = args;
    const res = await auditService.listAudit({ ...filters, page, take: get().meta.take });
    return { logs: res.data ?? [], meta: res.meta ?? get().meta };
  },

  actions: ({ set, get }) => ({
    /** Facets are advisory; a failure must not block the trail itself. */
    fetchFacets: async () => {
      try {
        const res = await auditService.getFacets();
        set({ facets: res.data ?? { resourceTypes: [], actions: [] } });
      } catch { /* non-fatal */ }
    },

    /** Set several filters, then read once — page 1, since the result set changed. */
    applyFilters: (patch) => {
      set({ filters: { ...get().filters, ...patch } });
      return get().fetch(1);
    },

    clearFilters: () => get().applyFilters({ resourceType: "", action: "", actorId: "", from: "", to: "" }),
  }),
});
