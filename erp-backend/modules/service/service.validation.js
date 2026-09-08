import { SERVICE_CODES } from "../../utils/serviceCodes.js";

/**
 * Service Selection — the closed Phase-1 catalog (ADR-041, CRM_MASTER §5.6a).
 *
 * The three service packages that used to sit above this catalog are gone, and with
 * them the compose request body: composition takes no inputs any more, so there is no
 * schema left to validate. SERVICE_CODES is re-exported for callers that read it here.
 */
export { SERVICE_CODES };
