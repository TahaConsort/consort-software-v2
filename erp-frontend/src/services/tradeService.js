/**
 * tradeService.js — export trade documents (Export Shipment Workflow roadmap §4).
 *
 * Two registers exist outside a shipment because the roadmap cycle starts before one
 * does (Step 1): contracts and financial instruments. Everything else is addressed
 * under a shipment id.
 *
 * Totals are never sent: packing-list totals and invoice totals are recomputed on the
 * server from their items/lines, and the responses carry the authoritative figures.
 */
import api from "@/lib/axios";

// ── §4.1 Trade contracts ─────────────────────────────────────────────────────
export const listContracts = async (params = {}) => {
  const q = new URLSearchParams(params).toString();
  const res = await api.get(`/trade/contracts${q ? `?${q}` : ""}`);
  return res.data;
};
export const getContract = async (id) => (await api.get(`/trade/contracts/${id}`)).data;
export const createContract = async (payload) => (await api.post("/trade/contracts", payload)).data;
export const updateContract = async (id, payload) => (await api.patch(`/trade/contracts/${id}`, payload)).data;

// ── §4.2 Financial instruments ───────────────────────────────────────────────
export const listInstruments = async (params = {}) => {
  const q = new URLSearchParams(params).toString();
  const res = await api.get(`/trade/instruments${q ? `?${q}` : ""}`);
  return res.data;
};
export const getInstrument = async (id) => (await api.get(`/trade/instruments/${id}`)).data;
export const createInstrument = async (payload) => (await api.post("/trade/instruments", payload)).data;
export const updateInstrument = async (id, payload) => (await api.patch(`/trade/instruments/${id}`, payload)).data;
export const addDrawdown = async (id, payload) => (await api.post(`/trade/instruments/${id}/drawdowns`, payload)).data;
export const closeInstrument = async (id, payload) => (await api.post(`/trade/instruments/${id}/close`, payload)).data;

// ── Shipment-scoped documents ────────────────────────────────────────────────

/** Everything the Trade Documents panel needs, in one round trip. */
export const getTradeOverview = async (shipmentId) => (await api.get(`/trade/shipments/${shipmentId}/overview`)).data;
export const getTradeAlerts = async (shipmentId) => (await api.get(`/trade/shipments/${shipmentId}/alerts`)).data;

export const addContainer = async (shipmentId, payload) =>
  (await api.post(`/trade/shipments/${shipmentId}/containers`, payload)).data;
export const updateContainer = async (shipmentId, containerId, payload) =>
  (await api.patch(`/trade/shipments/${shipmentId}/containers/${containerId}`, payload)).data;
export const removeContainer = async (shipmentId, containerId) =>
  (await api.delete(`/trade/shipments/${shipmentId}/containers/${containerId}`)).data;

export const savePackingList = async (shipmentId, payload) =>
  (await api.put(`/trade/shipments/${shipmentId}/packing-list`, payload)).data;
/** Replaces the whole item collection; the server recomputes the header totals. */
export const savePackingListItems = async (shipmentId, items) =>
  (await api.put(`/trade/shipments/${shipmentId}/packing-list/items`, { items })).data;
export const confirmPackingList = async (shipmentId) =>
  (await api.post(`/trade/shipments/${shipmentId}/packing-list/confirm`)).data;
export const generatePackingListPdf = async (shipmentId) =>
  (await api.post(`/trade/shipments/${shipmentId}/packing-list/pdf`)).data;

export const createTradeInvoice = async (shipmentId, payload) =>
  (await api.post(`/trade/shipments/${shipmentId}/invoices`, payload)).data;
export const updateTradeInvoice = async (shipmentId, invoiceId, payload) =>
  (await api.patch(`/trade/shipments/${shipmentId}/invoices/${invoiceId}`, payload)).data;
export const saveTradeInvoiceLines = async (shipmentId, invoiceId, lines) =>
  (await api.put(`/trade/shipments/${shipmentId}/invoices/${invoiceId}/lines`, { lines })).data;
/** Roadmap §6 — carry the cargo across instead of retyping it. */
export const seedInvoiceFromPackingList = async (shipmentId, invoiceId) =>
  (await api.post(`/trade/shipments/${shipmentId}/invoices/${invoiceId}/lines/from-packing-list`)).data;
export const issueTradeInvoice = async (shipmentId, invoiceId) =>
  (await api.post(`/trade/shipments/${shipmentId}/invoices/${invoiceId}/issue`)).data;
export const voidTradeInvoice = async (shipmentId, invoiceId, reason) =>
  (await api.post(`/trade/shipments/${shipmentId}/invoices/${invoiceId}/void`, { reason })).data;
export const generateInvoicePdf = async (shipmentId, invoiceId) =>
  (await api.post(`/trade/shipments/${shipmentId}/invoices/${invoiceId}/pdf`)).data;

export const saveBillOfLading = async (shipmentId, payload) =>
  (await api.put(`/trade/shipments/${shipmentId}/bill-of-lading`, payload)).data;

export const saveGoodsDeclaration = async (shipmentId, payload) =>
  (await api.put(`/trade/shipments/${shipmentId}/goods-declaration`, payload)).data;
export const saveGoodsDeclarationLines = async (shipmentId, lines) =>
  (await api.put(`/trade/shipments/${shipmentId}/goods-declaration/lines`, { lines })).data;

// ── Trade shipment origination (roadmap Step 1) ──────────────────────────────
export const createTradeShipment = async (payload) => (await api.post("/shipments/trade", payload)).data;
