import { requireRole } from "../auth/auth.middleware.js";

/**
 * Company, Contact & Customer access gates.
 *
 * The permission vocabulary has no company.* entries (BUSINESS_RULES §2.1) —
 * companies/contacts exist in service of the sales pipeline, so access follows
 * the sales sector: Management (full visibility) + ASM + BDO.
 * Customer records are read by the same sector; editing credit terms and
 * provisioning portal users is Management + ASM (a BDO never grants access).
 */

export const requireSalesSector = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "asm",
  "bdo",
);

export const requireCustomerAdmin = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "asm",
);
