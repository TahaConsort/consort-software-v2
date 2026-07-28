/**
 * queryService.js — Query Management (CRM_MASTER §5.6/§5.6a).
 * The services array on a query is the service-driven core (ADR-041).
 */
import api from "@/lib/axios";

export const listQueries = async (status) => {
  const res = await api.get(`/queries${status ? `?status=${status}` : ""}`);
  return res.data;
};

export const getQuery = async (id) => {
  const res = await api.get(`/queries/${id}`);
  return res.data;
};

// services: non-empty array of catalog codes (RULE-QRY-05)
export const createQuery = async (payload) => {
  const res = await api.post("/queries", payload);
  return res.data;
};

export const updateQuery = async (id, payload) => {
  const res = await api.put(`/queries/${id}`, payload);
  return res.data;
};

export const cancelQuery = async (id, reason) => {
  const res = await api.post(`/queries/${id}/cancel`, { reason });
  return res.data;
};
