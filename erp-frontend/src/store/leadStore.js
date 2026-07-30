import * as leadService from "@/services/leadService";
import { createResourceStore } from "@/lib/createResourceStore";
import { leadTopic, TOPICS } from "@/lib/topics";

/**
 * Lead store — the Lead Management list and its filters, plus the lead lifecycle.
 *
 * Status is the backend's to decide (WORKFLOW §2), so nothing is guessed client-side:
 * every mutation refetches and publishes.
 *
 * Two things this fixes. `convert` (RULE-LD-05) creates a customer, and nothing used to
 * tell `customerStore` — the new customer was missing from the Queries, Visits and
 * Outreach target pickers until those screens remounted. And `LeadDetailPage` refreshed
 * only its own detail, so qualifying or losing a lead and pressing Back showed the old
 * status in the list.
 *
 * NOTE for callers needing a lead list for a PICKER: use `referenceStore.leads`, not this
 * store. This one applies the Leads page's own filters, so a dialog reading it inherits
 * whatever the user last filtered by — which silently emptied the target dropdowns on
 * the Visits and Outreach screens.
 */
export const useLeadStore = createResourceStore({
  name: "leads",
  topics: [TOPICS.LEADS],

  state: { leads: [] },
  filters: { status: "", source: "" },

  load: async ({ filters }) => {
    const res = await leadService.listLeads({
      status: filters.status || undefined,
      source: filters.source || undefined,
    });
    return { leads: res.data ?? [] };
  },

  actions: ({ get, mutate }) => {
    const leadTopics = [TOPICS.LEADS, TOPICS.DASHBOARD];

    return {
      fetchLeads: () => get().fetch(),

      createLead: (payload) =>
        mutate(() => leadService.createLead(payload), { invalidates: leadTopics }),

      updateLead: (id, payload) =>
        mutate(() => leadService.updateLead(id, payload), {
          invalidates: [...leadTopics, leadTopic(id)],
        }),

      transitionLead: (id, payload) =>
        mutate(() => leadService.transitionLead(id, payload), {
          invalidates: [...leadTopics, leadTopic(id)],
        }),

      reopenLead: (id, reason) =>
        mutate(() => leadService.reopenLead(id, reason), {
          invalidates: [...leadTopics, leadTopic(id)],
        }),

      /** Writes an outreach touch and can advance the lead new → contacted. */
      logOutreach: (id, payload) =>
        mutate(() => leadService.logOutreach(id, payload), {
          invalidates: [...leadTopics, leadTopic(id), TOPICS.OUTREACH],
        }),

      /** RULE-LD-05 — produces a customer, which several other screens list. */
      convertLead: (id) =>
        mutate(() => leadService.convertLead(id), {
          invalidates: [...leadTopics, leadTopic(id), TOPICS.CUSTOMERS],
        }),
    };
  },
});
