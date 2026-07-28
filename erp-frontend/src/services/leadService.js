/**
 * leadService.js
 * API surface for the Lead Management module (CRM_MASTER §5.4, RULE-LD).
 */
import api from "@/lib/axios";

// GET /leads?status=&source= → hydrated leads (company, contact, ownerName)
export const listLeads = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  const qs = params.toString();
  const res = await api.get(`/leads${qs ? `?${qs}` : ""}`);
  return res.data;
};

// POST /leads — company/contact created once, at lead time (RULE-LD-01)
export const createLead = async (payload) => {
  const res = await api.post("/leads", payload);
  return res.data; // may carry duplicateWarning (EDGE-LD-01)
};

// GET /leads/:id → lead + statusHistory + outreach
export const getLead = async (id) => {
  const res = await api.get(`/leads/${id}`);
  return res.data;
};

// PUT /leads/:id — basics only (never source/status)
export const updateLead = async (id, payload) => {
  const res = await api.put(`/leads/${id}`, payload);
  return res.data;
};

// POST /leads/:id/outreach — first touch auto-advances new → contacted
export const logOutreach = async (id, payload) => {
  const res = await api.post(`/leads/${id}/outreach`, payload);
  return res.data;
};

// POST /leads/:id/status — { toStatus: contacted|qualified|lost, reason? }
export const transitionLead = async (id, payload) => {
  const res = await api.post(`/leads/${id}/status`, payload);
  return res.data;
};

// POST /leads/:id/reopen — lost → contacted with reason (RULE-LD-04)
export const reopenLead = async (id, reason) => {
  const res = await api.post(`/leads/${id}/reopen`, { reason });
  return res.data;
};

// POST /leads/:id/convert — one-transaction conversion (RULE-LD-05)
export const convertLead = async (id) => {
  const res = await api.post(`/leads/${id}/convert`);
  return res.data; // → the new customer
};
