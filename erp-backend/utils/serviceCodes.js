import { ServiceCode } from "@prisma/client";

/**
 * The Phase-1 service catalog (ADR-041), closed.
 *
 * This used to live in utils/servicePackage.js alongside the service-package matrix.
 * That matrix is gone — a Query's `services` is free text now — but ServiceCode itself
 * survives as the key for charge types, vendor RFQs, rate cards, vendor capability and
 * storefront listings, so the value list still needs one home.
 */
export const SERVICE_CODES = Object.values(ServiceCode);
