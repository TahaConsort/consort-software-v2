/**
 * workflowService.js — Workflow catalog admin (ADR-051). Management-only CRUD over
 * the step catalog, per-step checklists and the document-type vocabulary that the
 * composition engine reads at quote approval. Edits shape NEW shipments only (INV-14).
 */
import api from "@/lib/axios";

export const getMeta = async () => {
  const res = await api.get("/workflow/meta");
  return res.data;
};

export const listSteps = async () => {
  const res = await api.get("/workflow/steps");
  return res.data;
};

export const createStep = async (payload) => {
  const res = await api.post("/workflow/steps", payload);
  return res.data;
};

export const updateStep = async (stepCode, payload) => {
  const res = await api.patch(`/workflow/steps/${stepCode}`, payload);
  return res.data;
};

export const deleteStep = async (stepCode) => {
  const res = await api.delete(`/workflow/steps/${stepCode}`);
  return res.data;
};

export const replaceActions = async (stepCode, actions) => {
  const res = await api.put(`/workflow/steps/${stepCode}/actions`, { actions });
  return res.data;
};

export const listDocTypes = async () => {
  const res = await api.get("/workflow/doc-types");
  return res.data;
};

export const createDocType = async (payload) => {
  const res = await api.post("/workflow/doc-types", payload);
  return res.data;
};

export const updateDocType = async (code, payload) => {
  const res = await api.patch(`/workflow/doc-types/${code}`, payload);
  return res.data;
};

export const deleteDocType = async (code) => {
  const res = await api.delete(`/workflow/doc-types/${code}`);
  return res.data;
};

export const validateCatalog = async () => {
  const res = await api.get("/workflow/validate");
  return res.data;
};
