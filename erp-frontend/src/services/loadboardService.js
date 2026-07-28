/**
 * loadboardService.js — internal load board management (CRM_MASTER §5.20).
 * Operations/Transport curate the postings the public storefront shows.
 */
import api from "@/lib/axios";

export const listPostings = async (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return (await api.get(`/loadboard${qs ? `?${qs}` : ""}`)).data;
};

export const createPosting = async (payload) => (await api.post("/loadboard", payload)).data;

export const updatePosting = async (id, payload) => (await api.patch(`/loadboard/${id}`, payload)).data;

export const deletePosting = async (id) => (await api.delete(`/loadboard/${id}`)).data;
