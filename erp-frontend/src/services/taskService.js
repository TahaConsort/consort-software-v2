/**
 * taskService.js — Tasks (CRM_MASTER §5.12). Completing an OTD-step task
 * completes the step and advances the shipment (RULE-TK-02).
 */
import api from "@/lib/axios";

export const listTasks = async (params = {}) => {
  const q = new URLSearchParams(params).toString();
  const res = await api.get(`/tasks${q ? `?${q}` : ""}`);
  return res.data;
};

export const claimTask = async (id) => {
  const res = await api.post(`/tasks/${id}/claim`);
  return res.data;
};

export const completeTask = async (id, payload = {}) => {
  const res = await api.post(`/tasks/${id}/complete`, payload);
  return res.data;
};

export const reassignTask = async (id, assigneeId) => {
  const res = await api.post(`/tasks/${id}/reassign`, { assigneeId });
  return res.data;
};
