import { create } from "zustand";
import * as taskService from "@/services/taskService";

/** Task store (CRM_MASTER §5.12) — the department work queue. */
export const useTaskStore = create((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  statusFilter: "",

  setStatusFilter: (status) => {
    set({ statusFilter: status });
    get().fetchTasks();
  },

  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const params = {};
      if (get().statusFilter) params.status = get().statusFilter;
      const res = await taskService.listTasks(params);
      set({ tasks: res.data ?? [], loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to fetch tasks", loading: false });
    }
  },
}));
