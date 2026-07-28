/**
 * financeService.js — Finance (CRM_MASTER §5.11). Invoice issuance auto-
 * completes OTC 1; full settlement auto-completes OTC 2 (RULE-FI-02/03).
 */
import api from "@/lib/axios";

export const INVOICE_KIND_LABELS = { receivable: "Receivable", payable: "Payable" };

export const listInvoices = async (params = {}) => {
  const q = new URLSearchParams(params).toString();
  const res = await api.get(`/finance/invoices${q ? `?${q}` : ""}`);
  return res.data;
};

// Create a manual invoice (payable/receivable) from a step (§5.11).
export const createInvoice = async (payload) => {
  const res = await api.post("/finance/invoices", payload);
  return res.data;
};

// Draft an invoice from existing job-charges (freight-forwarding OTC upgrade).
export const createInvoiceFromCharges = async (payload) => {
  const res = await api.post("/finance/invoices/from-charges", payload);
  return res.data;
};

export const issueInvoice = async (id) => {
  const res = await api.post(`/finance/invoices/${id}/issue`);
  return res.data;
};

export const recordPayment = async (id, payload) => {
  const res = await api.post(`/finance/invoices/${id}/payments`, payload);
  return res.data;
};

export const voidInvoice = async (id, reason) => {
  const res = await api.post(`/finance/invoices/${id}/void`, { reason });
  return res.data;
};
