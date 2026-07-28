/**
 * quotationService.js — Quotation (CRM_MASTER §5.7). Approval is the pivot
 * (RULE-QT-07): it births the shipment + composed OTD path.
 */
import api from "@/lib/axios";

export const listQuotations = async (params = {}) => {
  const q = new URLSearchParams(params).toString();
  const res = await api.get(`/quotations${q ? `?${q}` : ""}`);
  return res.data;
};

export const getQuotation = async (id) => {
  const res = await api.get(`/quotations/${id}`);
  return res.data;
};

export const createQuotation = async (payload) => {
  const res = await api.post("/quotations", payload);
  return res.data;
};

export const updateQuotation = async (id, payload) => {
  const res = await api.put(`/quotations/${id}`, payload);
  return res.data;
};

export const sendQuotation = async (id) => {
  const res = await api.post(`/quotations/${id}/send`);
  return res.data;
};

export const approveQuotation = async (id, rowVersion) => {
  const res = await api.post(`/quotations/${id}/approve`, rowVersion != null ? { rowVersion } : {});
  return res.data;
};

export const rejectQuotation = async (id, reason) => {
  const res = await api.post(`/quotations/${id}/reject`, { reason });
  return res.data;
};

export const reviseQuotation = async (id) => {
  const res = await api.post(`/quotations/${id}/revise`);
  return res.data;
};
