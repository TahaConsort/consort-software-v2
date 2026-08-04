import { z } from "zod";
import {
  allowedCroModes,
  allowedLcModes,
  CRO_MODES,
  INLAND_MODES,
  LC_MODES,
  SERVICE_CODES,
  SERVICE_PACKAGES,
  packageUsesDeliveryAddress,
  packageUsesDestinationPort,
  packageUsesImportTerms,
  packageUsesPickupAddress,
  packageUsesPorts,
} from "../../utils/servicePackage.js";

/**
 * Query Management — request schemas (CRM_MASTER §5.6/§5.6a, RULE-QRY).
 *
 * A query records the SERVICE PACKAGE the customer chose. The package presets the
 * non-empty `services[]` set (RULE-QRY-05, ADR-041) that later composes the shipment's
 * OTD path (ADR-040); `services` on the wire is only the optional Ops fine-tune ON TOP
 * of that preset, which is why it is no longer required.
 */

// Re-exported for callers that used to import it from here.
export { SERVICE_CODES };

const baseQueryFields = {
  // Optional on the wire: portal users are scoped to their own customer, which the
  // controller supplies from req.user.customerId. Internal callers must pass it —
  // enforced in the controller, which is where the actor is known.
  customerId: z.string().min(1).optional(),
  servicePackage: z.enum(SERVICE_PACKAGES),
  croHandledBy: z.enum(CRO_MODES).optional(),
  // ADR-050 — who manages the Letter of Credit. Optional: the resolver defaults it
  // (bank-LC customers → consort; everyone else → no LC).
  lcHandledBy: z.enum(LC_MODES).optional(),
  // Additive Ops overrides on top of the package preset — never the whole selection.
  services: z.array(z.enum(SERVICE_CODES)).optional(),
  originPort: z.string().optional(),
  destinationPort: z.string().optional(),
  // Free-text door addresses — the vocabulary for local_transport, where a UN/LOCODE
  // port is the wrong shape.
  pickupAddress: z.string().max(500).optional(),
  deliveryAddress: z.string().max(500).optional(),
  // Shipper/consignee contacts — the people at the doors, optional-but-encouraged.
  senderName: z.string().max(200).optional(),
  senderPhone: z.string().max(50).optional(),
  senderAddress: z.string().max(500).optional(),
  receiverName: z.string().max(200).optional(),
  receiverPhone: z.string().max(50).optional(),
  receiverAddress: z.string().max(500).optional(),
  // Truck (default) or rail. Rail splits the inland leg into first/middle/last mile,
  // which the RFQ module then prices per leg.
  inlandMode: z.enum(INLAND_MODES).optional(),
  originRailTerminal: z.string().max(200).optional(),
  destinationRailTerminal: z.string().max(200).optional(),
  // port_to_consignee terms. Both optional at intake — the delivery order often lands
  // after the query is raised, and the free-days count comes with it. The order_confirmed
  // checklist is what actually forces them to be settled before the container moves.
  freeDays: z.coerce.number().int().min(0).max(365).optional(),
  emptyReturnLocation: z.string().max(500).optional(),
  containerTypeCode: z.string().optional(),
  incoterm: z.string().optional(),
  cargoDescription: z.string().optional(),
  weightKg: z.coerce.number().positive().optional(),
  isHazardous: z.boolean().optional(),
  isReefer: z.boolean().optional(),
};

/**
 * CONTRADICTIONS — checks that must hold on create AND update, because violating one
 * leaves a row the DB CHECK (queries_cro_mode_valid) rejects or that composition
 * cannot serve. Each is skipped when the field it depends on is absent, so a partial
 * update is never asked about something it isn't changing.
 */
const refineCoherence = (schema) =>
  schema
    .refine(
      (v) =>
        v.servicePackage === undefined ||
        v.croHandledBy === undefined ||
        allowedCroModes(v.servicePackage).includes(v.croHandledBy),
      { path: ["croHandledBy"], message: "This CRO option is not available for the selected service" },
    )
    .refine(
      (v) =>
        v.servicePackage === undefined ||
        v.lcHandledBy === undefined ||
        allowedLcModes(v.servicePackage).includes(v.lcHandledBy),
      { path: ["lcHandledBy"], message: "An LC option is only available on export services" },
    )
    .refine((v) => v.servicePackage !== "local_transport" || !v.originPort, {
      path: ["originPort"],
      message: "Local Transport moves between addresses — leave the port fields empty",
    })
    .refine((v) => v.servicePackage !== "local_transport" || !v.destinationPort, {
      path: ["destinationPort"],
      message: "Local Transport moves between addresses — leave the port fields empty",
    })
    // The import leg ENDS at a door, so a destination port is a contradiction: the
    // origin port is the terminal holding the container.
    .refine((v) => v.servicePackage !== "port_to_consignee" || !v.destinationPort, {
      path: ["destinationPort"],
      message: "Import delivery ends at the consignee's address — leave the destination port empty",
    })
    .refine((v) => v.servicePackage === undefined || packageUsesImportTerms(v.servicePackage) || v.freeDays === undefined, {
      path: ["freeDays"],
      message: "Free days apply to an import delivery only",
    })
    // Rail terminals only make sense on a rail-mode inland leg. Skipped when the
    // mode is absent (partial update touching neither field).
    .refine(
      (v) =>
        v.inlandMode === undefined ||
        v.inlandMode === "rail" ||
        (!v.originRailTerminal && !v.destinationRailTerminal),
      { path: ["originRailTerminal"], message: "Rail terminals only apply when the inland leg moves by rail" },
    );

/**
 * COMPLETENESS — create-only. An update must not demand fields it isn't touching, so
 * these are not applied to updateQuerySchema.
 */
const refineCompleteness = (schema) =>
  schema
    .refine((v) => !packageUsesPickupAddress(v.servicePackage) || !!v.pickupAddress, {
      path: ["pickupAddress"],
      message: "A pickup address is required for Local Transport",
    })
    // Local Transport and the import leg both END at a door — Local Transport starts at
    // one too, the import leg starts at the terminal named by originPort.
    .refine((v) => !packageUsesDeliveryAddress(v.servicePackage) || !!v.deliveryAddress, {
      path: ["deliveryAddress"],
      message: "A delivery address is required for this service",
    })
    .refine((v) => !packageUsesPorts(v.servicePackage) || !!v.originPort, {
      path: ["originPort"],
      message: "An origin port is required for this service",
    })
    .refine((v) => !packageUsesDestinationPort(v.servicePackage) || !!v.destinationPort, {
      path: ["destinationPort"],
      message: "A destination port is required for an international shipment",
    });

export const createQuerySchema = refineCompleteness(refineCoherence(z.object(baseQueryFields)));

// Editable while `open` — package/services included (still pre-quote); never status.
export const updateQuerySchema = refineCoherence(
  z.object(baseQueryFields).omit({ customerId: true }).partial(),
);

export const cancelQuerySchema = z.object({
  reason: z.string().min(3, "A cancellation reason is required (RULE-QRY-03)"),
});
