import { z } from "zod";
import { CRO_MODES, SERVICE_CODES, SERVICE_PACKAGES } from "../../utils/servicePackage.js";

/**
 * Service Selection — the closed Phase-1 catalog (ADR-041, CRM_MASTER §5.6a) and the
 * three service packages layered above it. The vocabulary lives in
 * utils/servicePackage.js; this module only shapes requests.
 */
export { SERVICE_CODES };

export const composeSchema = z
  .object({
    servicePackage: z.enum(SERVICE_PACKAGES).optional(),
    croHandledBy: z.enum(CRO_MODES).optional(),
    services: z.array(z.enum(SERVICE_CODES)).optional(),
  })
  // Either shape is accepted — a package (preferred) or a bare service list (older
  // callers, from which a package is inferred) — but not neither.
  .refine((v) => !!v.servicePackage || (v.services?.length ?? 0) > 0, {
    path: ["servicePackage"],
    message: "Provide a servicePackage (or at least one service)",
  });
