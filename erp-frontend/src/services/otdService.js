/**
 * otdService.js — OTD, Order to Delivery (CRM_MASTER §5.9). The service-composed
 * step engine at /api/otd. Progress is written only through step completion;
 * `shipments.status` is derived (ADR-014). Completion is department-scoped
 * (RULE-SH-04); reopen cascades forward (RULE-SH-05).
 */
import api from "@/lib/axios";

export const getSteps = async (shipmentId) => {
  const res = await api.get(`/otd/${shipmentId}/steps`);
  return res.data;
};

export const completeStep = async (shipmentId, displayNo, payload = {}) => {
  const res = await api.patch(`/otd/${shipmentId}/steps/${displayNo}/complete`, payload);
  return res.data;
};

export const reopenStep = async (shipmentId, displayNo, reason) => {
  const res = await api.patch(`/otd/${shipmentId}/steps/${displayNo}/reopen`, { reason });
  return res.data;
};

// Tick / untick one MANUAL sub-action of a step (RULE-SH-13, ADR-048). Document
// sub-actions are satisfied by attaching the file, never by this call.
export const setStepAction = async (shipmentId, displayNo, actionCode, done = true) => {
  const res = await api.patch(`/otd/${shipmentId}/steps/${displayNo}/actions/${actionCode}`, { done });
  return res.data;
};

// Save per-step notes / structured form data (capture for the step owner).
export const updateStepDetails = async (shipmentId, displayNo, payload) => {
  const res = await api.patch(`/otd/${shipmentId}/steps/${displayNo}/details`, payload);
  return res.data;
};
