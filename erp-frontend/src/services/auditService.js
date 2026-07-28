/**
 * auditService.js — Audit trail (CRM_MASTER §5.19). Management-only. Every
 * mutation is written once server-side (INV-15); this reads it back.
 */
import api from "@/lib/axios";

export const listAudit = async (params = {}) => {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
  const q = new URLSearchParams(clean).toString();
  const res = await api.get(`/audit${q ? `?${q}` : ""}`);
  return res.data;
};

export const getFacets = async () => {
  const res = await api.get("/audit/facets");
  return res.data;
};

export const resourceHistory = async (resourceType, resourceId) => {
  const res = await api.get(`/audit/resource/${resourceType}/${resourceId}`);
  return res.data;
};
