import * as shipmentService from "@/services/shipmentService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Shipment store (CRM_MASTER §5.8) — the list, with status/exception filters.
 *
 * Read-only by design: a shipment's own lifecycle writes (hold/resume/cancel/close/
 * schedule) belong to whichever shipment is open, so they live in shipmentDetailStore
 * and publish `shipments` from there. This store just owns the topic, which is why the
 * list is now correct after work is recorded on a detail screen, after a quotation is
 * approved into a new shipment, and after a task completion advances a status —
 * none of which used to reach it without a reload.
 *
 * `setFilter` writes into the nested `filters` object. The previous version did
 * `set({ [key]: value })`, which would write an arbitrary top-level state field on any
 * typo'd key and corrupt the store silently.
 */
export const useShipmentStore = createResourceStore({
  name: "shipments",
  topics: [TOPICS.SHIPMENTS],

  state: { shipments: [] },
  // `owner` is the ops-ownership lens: "me" my desk, "none" the claimable pool,
  // "" everything I can see.
  filters: { status: "", exceptionState: "", owner: "" },

  load: async ({ filters }) => {
    const params = {};
    if (filters.status) params.status = filters.status;
    if (filters.exceptionState) params.exceptionState = filters.exceptionState;
    if (filters.owner) params.opsOwnerId = filters.owner;
    const res = await shipmentService.listShipments(params);
    return { shipments: res.data ?? [] };
  },

  actions: ({ get, mutate }) => ({
    fetchShipments: () => get().fetch(),

    // Claiming moves the job onto my desk and its queued operations tasks with it,
    // so the task list is invalidated alongside the shipment list.
    claim: (id) =>
      mutate(() => shipmentService.claimShipment(id), {
        invalidates: [TOPICS.SHIPMENTS, TOPICS.TASKS, TOPICS.DASHBOARD],
      }),
  }),
});
