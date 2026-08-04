import { requireRole } from "../auth/auth.middleware.js";

/**
 * Vendor RFQ access.
 *
 * The buy side is an ops-and-management concern only: ops runs the rate requests,
 * management watches the margin. Sales (asm/bdo) and portal customers never reach
 * this module — a customer must not see what Consort pays, and there is no
 * customer- or owner-scoped subset to carve out here, so unlike queries and
 * quotations this needs no row scope, just the role gate.
 */
export const requireRfqAccess = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "ops_manager",
  "ops_exec",
);
