import { create } from "zustand";
import * as financeService from "@/services/financeService";
import { PAYMENT_STATE_FILTERS } from "@/lib/catalog";

/**
 * Finance store (CRM_MASTER §5.11). Invoice list + issue / record-payment / void
 * actions for the Accounts workspace. Issuing auto-completes OTC 1 and full
 * payment auto-completes OTC 2 server-side (RULE-FI-02/03); the store just
 * refetches after each action.
 */
export const useFinanceStore = create((set, get) => ({
  invoices: [], // the current tab's invoices, after the payment-state filter
  allOfKind: [], // the same tab BEFORE that filter — the summary must total the tab, not the filtered view
  statusFilter: "", // a PAYMENT_STATE_FILTERS value, not a raw invoice status
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
      const all = res.data ?? [];
      const k = get().kindFilter;
      const ofKind = k ? all.filter((i) => (i.kind ?? "receivable") === k) : all;

      // The filter is a payment state ("unpaid"), which spans several raw
      // statuses (draft + issued), so map it before comparing.
      const f = get().statusFilter;
      const statuses = PAYMENT_STATE_FILTERS.find((s) => s.value === f)?.statuses;
      const invoices = statuses ? ofKind.filter((i) => statuses.includes(i.status)) : ofKind;

      set({ invoices, allOfKind: ofKind, loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to load invoices", loading: false });
    }
  },

  createInvoice: async (payload) => {
    set({ busy: true });
    try {
      const res = await financeService.createInvoice(payload);
      await get().fetchInvoices();
      return res;
    } finally {
      set({ busy: false });
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
