/**
 * customerService.js
 * API surface for the Company, Contact & Customer module (CRM_MASTER §5.3).
 * Customers are only born from lead conversion (RULE-LD-05) — no create here.
 */
import api from "@/lib/axios";

/* ── Companies ── */

// GET /companies?q= — search for the add-lead duplicate check / link-existing
export const listCompanies = async (q = "") => {
  const res = await api.get(`/companies${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return res.data;
};

export const getCompany = async (id) => {
  const res = await api.get(`/companies/${id}`);
  return res.data;
};

export const updateCompany = async (id, payload) => {
  const res = await api.put(`/companies/${id}`, payload);
  return res.data;
};

export const addContact = async (companyId, payload) => {
  const res = await api.post(`/companies/${companyId}/contacts`, payload);
  return res.data;
};

export const updateContact = async (contactId, payload) => {
  const res = await api.put(`/companies/contacts/${contactId}`, payload);
  return res.data;
};

/* ── Customers ── */

export const listCustomers = async () => {
  const res = await api.get("/customers");
  return res.data;
};

export const getCustomer = async (id) => {
  const res = await api.get(`/customers/${id}`);
  return res.data;
};

// Management + ASM only (credit terms, BDO assignment)
export const updateCustomer = async (id, payload) => {
  const res = await api.put(`/customers/${id}`, payload);
  return res.data;
};

// Management + ASM only — provisions a portal login (activation flow)
export const createPortalUser = async (customerId, email) => {
  const res = await api.post(`/customers/${customerId}/portal-users`, { email });
  return res.data; // devActivationToken in non-prod
};
