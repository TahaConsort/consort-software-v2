/**
 * vendorService.js — Vendor master (freight-forwarding OTC upgrade). Vendors are
 * the counterparties on payable charges/invoices (transporters, shipping lines,
 * container yards, customs & destination agents, port terminals).
 */
import api from "@/lib/axios";

export const listVendors = async (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
  return (await api.get(`/vendors${qs ? `?${qs}` : ""}`)).data;
};

export const getVendor = async (id) => (await api.get(`/vendors/${id}`)).data;

export const createVendor = async (payload) => (await api.post("/vendors", payload)).data;

export const updateVendor = async (id, payload) => (await api.patch(`/vendors/${id}`, payload)).data;

export const deactivateVendor = async (id) => (await api.post(`/vendors/${id}/deactivate`)).data;

export const deleteVendor = async (id) => (await api.delete(`/vendors/${id}`)).data;

/**
 * Email a vendor asking for their rates (the Quote button on the vendor card).
 * `message` is optional free text appended to the request in the vendor's own copy.
 */
export const requestVendorQuote = async (id, payload = {}) =>
  (await api.post(`/vendors/${id}/quote-request`, payload)).data;
