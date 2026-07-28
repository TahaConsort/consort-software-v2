/**
 * actionEngineService.js — Action Engine read surface (CRM_MASTER §5.12).
 * Management-only visibility into task templates, the outbox event flow, and
 * unroutable escalations (RULE-AE-05). The engine itself runs headless server-side.
 */
import api from "@/lib/axios";

export const getTemplates = async () => {
  const res = await api.get("/action-engine/templates");
  return res.data;
};

export const getOutbox = async (params = {}) => {
  const q = new URLSearchParams(params).toString();
  const res = await api.get(`/action-engine/outbox${q ? `?${q}` : ""}`);
  return res.data;
};

export const getUnroutable = async () => {
  const res = await api.get("/action-engine/unroutable");
  return res.data;
};
