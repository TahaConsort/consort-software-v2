/**
 * chargeService.js — job-charge ledger (freight-forwarding OTC upgrade). One row
 * per expected/actual money movement on a shipment; powers per-step money, job
 * P&L, and invoice generation.
 */
import api from "@/lib/axios";

export const listCharges = async (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
  return (await api.get(`/charges${qs ? `?${qs}` : ""}`)).data;
};

export const listChargeTypes = async () => (await api.get("/charges/types")).data;

export const createCharge = async (payload) => (await api.post("/charges", payload)).data;

export const confirmCharge = async (id, payload) => (await api.patch(`/charges/${id}/confirm`, payload)).data;

export const cancelCharge = async (id, reason) => (await api.patch(`/charges/${id}/cancel`, { reason })).data;
