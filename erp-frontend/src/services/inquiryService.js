/**
 * inquiryService.js — Public Inquiry triage (CRM_MASTER §5.20). Internal, for
 * the Sales inbox: review a storefront request and convert it to a lead + query.
 */
import api from "@/lib/axios";

export const listInquiries = async (status) =>
  (await api.get(`/inquiries${status ? `?status=${status}` : ""}`)).data;

export const getInquiry = async (id) => (await api.get(`/inquiries/${id}`)).data;

export const setInquiryStatus = async (id, status) =>
  (await api.patch(`/inquiries/${id}/status`, { status })).data;

export const convertInquiry = async (id, payload = {}) =>
  (await api.post(`/inquiries/${id}/convert`, payload)).data;
