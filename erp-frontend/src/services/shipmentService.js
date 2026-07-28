/**
 * shipmentService.js — Shipment (CRM_MASTER §5.8): reads + the exception
 * lifecycle. OTD step progression lives in otdService (§5.9), OTC milestones in
 * otcService (§5.10). Status is derived, never written (ADR-014).
 */
import api from "@/lib/axios";

export const listShipments = async (params = {}) => {
  const q = new URLSearchParams(params).toString();
  const res = await api.get(`/shipments${q ? `?${q}` : ""}`);
  return res.data;
};

export const getShipment = async (id) => {
  const res = await api.get(`/shipments/${id}`);
  return res.data;
};

// Job P&L — estimated vs actual revenue/cost/margin + open payables.
export const getShipmentPnl = async (id) => {
  const res = await api.get(`/shipments/${id}/pnl`);
  return res.data;
};

export const holdShipment = async (id, payload) => {
  const res = await api.post(`/shipments/${id}/hold`, payload);
  return res.data;
};

export const resumeShipment = async (id, resolutionNotes) => {
  const res = await api.post(`/shipments/${id}/resume`, { resolutionNotes });
  return res.data;
};

export const cancelShipment = async (id, reason) => {
  const res = await api.post(`/shipments/${id}/cancel`, { reason });
  return res.data;
};

export const closeShipment = async (id) => {
  const res = await api.post(`/shipments/${id}/close`);
  return res.data;
};

// Set planned schedule dates — payload { etd?, eta? } as ISO dates ("shipment.schedule").
export const setSchedule = async (id, payload) => {
  const res = await api.patch(`/shipments/${id}/schedule`, payload);
  return res.data;
};
