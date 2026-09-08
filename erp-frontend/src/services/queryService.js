/**
 * queryService.js — Query Management (CRM_MASTER §5.6/§5.6a).
 * The services array on a query is the service-driven core (ADR-041).
 */
import api from "@/lib/axios";

// params: { status?, channel? } — channel is one of bdo | bank_lc | website.
// A bare string still works for old callers that only ever passed a status.
export const listQueries = async (params = {}) => {
  if (typeof params === "string") params = { status: params };
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
  const q = new URLSearchParams(clean).toString();
  const res = await api.get(`/queries${q ? `?${q}` : ""}`);
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

// Take ownership of an unclaimed query — assigns the CUSTOMER to the calling BDO,
// which moves every query for them out of the shared pool (§5.20).
export const claimQuery = async (id) => {
  const res = await api.post(`/queries/${id}/claim`);
  return res.data;
};
