/**
 * rfqService.js — Vendor rate requests (the buy side of a query).
 *
 * Consort resells: every service on a query is bought from a vendor first. An RFQ
 * asks N vendors for a price on one service; ops types the replies in, awards one,
 * and the winning lines seed the customer quotation's cost sheet.
 */
import api from "@/lib/axios";

export const listRfqs = async (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
  return (await api.get(`/rfqs${qs ? `?${qs}` : ""}`)).data;
};

export const getRfq = async (id) => (await api.get(`/rfqs/${id}`)).data;

/** The awarded buy price per service, shaped for the quote builder. */
export const getCostSheet = async (queryId) => (await api.get(`/rfqs/cost-sheet?queryId=${queryId}`)).data;

/** Batch: one RFQ per requested service. */
export const createRfqs = async (payload) => (await api.post("/rfqs", payload)).data;

export const addVendors = async (id, vendorIds) => (await api.post(`/rfqs/${id}/vendors`, { vendorIds })).data;

export const enterQuote = async (id, quoteId, payload) =>
  (await api.put(`/rfqs/${id}/quotes/${quoteId}`, payload)).data;

export const declineQuote = async (id, quoteId) =>
  (await api.post(`/rfqs/${id}/quotes/${quoteId}/decline`)).data;

export const selectQuote = async (id, quoteId) =>
  (await api.post(`/rfqs/${id}/quotes/${quoteId}/select`)).data;

export const cancelRfq = async (id, reason) => (await api.post(`/rfqs/${id}/cancel`, { reason })).data;

/**
 * Render + attach the awarded vendor's Rate Confirmation PDF.
 * Returns { documentId, fileName } for an immediate download.
 */
export const generateVendorRc = async (id, quoteId) =>
  (await api.post(`/rfqs/${id}/quotes/${quoteId}/rc`)).data;
