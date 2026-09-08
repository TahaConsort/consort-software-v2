/**
 * serviceCatalogService.js — Service Selection, the service-driven core
 * (CRM_MASTER §5.6a, ADR-040/041). Reads the catalog and previews the OTD path
 * a given service set would compose.
 */
import api from "@/lib/axios";

export const getCatalog = async () => {
  const res = await api.get("/services/catalog");
  return res.data;
};

// { ports, containerTypes } — reference data for the query form.
export const getReference = async () => {
  const res = await api.get("/services/reference");
  return res.data;
};

/**
 * Preview the OTD path a shipment runs — the same composition it gets at quote approval.
 * Every shipment runs the one path now, so this takes no inputs.
 * → { steps, stepCount, departments, requiredDocTypes }
 */
export const composeServices = async () => {
  const res = await api.post("/services/compose", {});
  return res.data;
};
