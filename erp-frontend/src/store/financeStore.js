import { create } from "zustand";
import * as financeService from "@/services/financeService";

/**
 * Finance store (CRM_MASTER §5.11). Invoice list + issue / record-payment / void
 * actions for the Accounts workspace. Issuing auto-completes OTC 1 and full
 * payment auto-completes OTC 2 server-side (RULE-FI-02/03); the store just
 * refetches after each action.
 */
export const useFinanceStore = create((set, get) => ({
  invoices: [],
  statusFilter: "",
  kindFilter: "receivable", // receivable | payable — the two tabs
  loading: false,
  busy: false,
  error: null,

  setFilter: (value) => {
    set({ statusFilter: value });
    get().fetchInvoices();
  },

  setKindFilter: (value) => {
    set({ kindFilter: value });
    get().fetchInvoices();
  },

  fetchInvoices: async () => {
    set({ loading: true, error: null });
    try {
      const res = await financeService.listInvoices();
      let invoices = res.data ?? [];
      const f = get().statusFilter;
      const k = get().kindFilter;
      if (k) invoices = invoices.filter((i) => (i.kind ?? "receivable") === k);
      if (f) invoices = invoices.filter((i) => i.status === f);
      set({ invoices, loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to load invoices", loading: false });
    }
  },

  issueInvoice: async (id) => {
    set({ busy: true });
    try {
      const res = await financeService.issueInvoice(id);
      await get().fetchInvoices();
      return res;
    } finally {
      set({ busy: false });
    }
  },

  recordPayment: async (id, payload) => {
    set({ busy: true });
    try {
      const res = await financeService.recordPayment(id, payload);
      await get().fetchInvoices();
      return res;
    } finally {
      set({ busy: false });
    }
  },

  voidInvoice: async (id, reason) => {
    set({ busy: true });
    try {
      const res = await financeService.voidInvoice(id, reason);
      await get().fetchInvoices();
      return res;
    } finally {
      set({ busy: false });
    }
  },
}));
