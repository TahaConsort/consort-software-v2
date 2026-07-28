import { create } from "zustand";
import * as shipmentService from "@/services/shipmentService";

/** Shipment store (CRM_MASTER §5.8) — list + status/exception filters. */
export const useShipmentStore = create((set, get) => ({
  shipments: [],
  loading: false,
  error: null,
  statusFilter: "",
  exceptionFilter: "",

  setFilter: (key, value) => {
    set({ [key]: value });
    get().fetchShipments();
  },

  fetchShipments: async () => {
    set({ loading: true, error: null });
    try {
      const params = {};
      if (get().statusFilter) params.status = get().statusFilter;
      if (get().exceptionFilter) params.exceptionState = get().exceptionFilter;
      const res = await shipmentService.listShipments(params);
      set({ shipments: res.data ?? [], loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to fetch shipments", loading: false });
    }
  },
}));
