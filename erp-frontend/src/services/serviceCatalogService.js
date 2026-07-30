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

// The three service packages + their CRO options and port requirements.
export const getPackages = async () => {
  const res = await api.get("/services/packages");
  return res.data;
};

/**
 * Preview the OTD path a shipment would run — the same composition it gets at quote
 * approval. Pass a package (preferred); for Loading Point → Port the CRO mode; for the
 * export packages the LC mode (ADR-050); `services` is the optional additive Ops override.
 * → { servicePackage, croHandledBy, lcHandledBy, services, steps, stepCount, departments, requiredDocTypes }
 */
export const composeServices = async ({ servicePackage, croHandledBy, lcHandledBy, services } = {}) => {
  const res = await api.post("/services/compose", { servicePackage, croHandledBy, lcHandledBy, services });
  return res.data;
};
