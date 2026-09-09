/**
 * The document-type vocabulary, served from `document_types` (ADR-051) with a small
 * module-level cache so the upload hot path doesn't pay a query per request.
 *
 * Staleness: the workflow admin invalidates on every write, so the instance that took
 * the edit is fresh immediately; other serverless instances converge within TTL_MS.
 * A 60s lag on a vocabulary edit is harmless — uploads of a brand-new type simply
 * succeed a minute later — and the alternative (per-request reads) taxes every upload.
 */
import prisma from "../../config/prisma.js";

const TTL_MS = 60_000;

let cache = null; // { rows, at }

export const invalidateDocTypes = () => {
  cache = null;
};

export const getDocTypes = async () => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await prisma.documentType.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  cache = { rows, at: Date.now() };
  return rows;
};

/** Uploads may only carry an ACTIVE type; historical rows keep resolving via labels. */
export const isValidDocType = async (code) => {
  const rows = await getDocTypes();
  return rows.some((t) => t.code === code && t.active);
};

export const isCustomerUploadable = async (code) => {
  const rows = await getDocTypes();
  return rows.some((t) => t.code === code && t.active && t.customerUploadable);
};

export const customerUploadableCodes = async () => {
  const rows = await getDocTypes();
  return rows.filter((t) => t.active && t.customerUploadable).map((t) => t.code);
};

/**
 * Types whose documents only count once ops has VERIFIED them — the customer's signed
 * Rate Confirmation before Order Lock. Kept on the TYPE rather than on each step's
 * checklist item: every gate reader already keys on docType, so one flag covers both
 * gate sources (a template's requiredDocTypes and a step's document sub-actions) and
 * no per-shipment row has to be rewritten when the rule changes.
 */
export const verificationRequiredCodes = async () => {
  const rows = await getDocTypes();
  return new Set(rows.filter((t) => t.requiresVerification).map((t) => t.code));
};

/** code → label for every row ever seeded, active or not (historical docs need labels). */
export const docTypeLabels = async () => {
  const rows = await getDocTypes();
  return Object.fromEntries(rows.map((t) => [t.code, t.label]));
};
