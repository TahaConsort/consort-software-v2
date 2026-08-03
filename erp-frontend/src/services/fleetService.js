/**
 * fleetService.js — Own-fleet master: drivers and vehicles (trucks/dumpers).
 * Read: `fleet.read`; writes: `fleet.manage`. Distinct from vendorService —
 * a driver is our own record, never a counterparty on a payable invoice.
 */
import api from "@/lib/axios";

const qs = (params = {}) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== ""),
  ).toString();
  return s ? `?${s}` : "";
};

// ── Drivers ──
export const listDrivers = async (params = {}) => (await api.get(`/drivers${qs(params)}`)).data;
export const getDriver = async (id) => (await api.get(`/drivers/${id}`)).data;
export const createDriver = async (payload) => (await api.post("/drivers", payload)).data;
export const updateDriver = async (id, payload) => (await api.patch(`/drivers/${id}`, payload)).data;
export const deactivateDriver = async (id) => (await api.post(`/drivers/${id}/deactivate`)).data;

// ── Vehicles (kind: truck | dumper) ──
export const listVehicles = async (params = {}) => (await api.get(`/vehicles${qs(params)}`)).data;
export const getVehicle = async (id) => (await api.get(`/vehicles/${id}`)).data;
export const createVehicle = async (payload) => (await api.post("/vehicles", payload)).data;
export const updateVehicle = async (id, payload) => (await api.patch(`/vehicles/${id}`, payload)).data;
export const deactivateVehicle = async (id) => (await api.post(`/vehicles/${id}/deactivate`)).data;
