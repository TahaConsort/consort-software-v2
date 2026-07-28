import { create } from "zustand";
import * as customerService from "@/services/customerService";

/**
 * Customer store — list state for the Company, Contact & Customer module.
 * Customers only appear here after a lead conversion (RULE-LD-05).
 */
export const useCustomerStore = create((set) => ({
  customers: [],
  loading: false,
  error: null,

  fetchCustomers: async () => {
    set({ loading: true, error: null });
    try {
      const res = await customerService.listCustomers();
      set({ customers: res.data ?? [], loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to fetch customers", loading: false });
    }
  },
}));
