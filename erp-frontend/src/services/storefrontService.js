/**
 * storefrontService.js — the PUBLIC storefront API (CRM_MASTER §5.20). These
 * endpoints are anonymous; the shared axios instance simply omits the Bearer
 * token when there is none, so it is safe to call them without a session.
 */
import api from "@/lib/axios";

// { ports, containerTypes, services } — reference data for the calculator form.
export const getStorefrontReference = async () => (await api.get("/public/reference")).data;

// Active, open load board postings (optionally filtered).
export const getLoadBoard = async (filters = {}) => {
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  ).toString();
  return (await api.get(`/public/loadboard${params ? `?${params}` : ""}`)).data;
};

// Indicative price breakdown — nothing is persisted.
export const getRateQuote = async (payload) => (await api.post("/public/rate-quote", payload)).data;

// "Request a quote" → creates a Public Inquiry for Sales to triage.
export const submitInquiry = async (payload) => (await api.post("/public/inquiries", payload)).data;
