/**
 * visitService.js — Visit Plans (ADR-043, WORKFLOW §2a).
 */
import api from "@/lib/axios";

export const listVisits = async (status) => {
  const res = await api.get(`/visits${status ? `?status=${status}` : ""}`);
  return res.data;
};

// Target exactly one of { leadId, customerId }.
export const createVisit = async (payload) => {
  const res = await api.post("/visits", payload);
  return res.data;
};

// Completion records the outreach touch (RULE-VP-02) and can advance the lead.
export const completeVisit = async (id, payload) => {
  const res = await api.post(`/visits/${id}/complete`, payload);
  return res.data;
};

export const noShowVisit = async (id) => {
  const res = await api.post(`/visits/${id}/no-show`);
  return res.data;
};

export const cancelVisit = async (id, reason) => {
  const res = await api.post(`/visits/${id}/cancel`, { reason });
  return res.data;
};

export const rescheduleVisit = async (id, plannedAt) => {
  const res = await api.post(`/visits/${id}/reschedule`, { plannedAt });
  return res.data;
};
