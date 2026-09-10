import { z } from "zod";
import { SERVICE_CODES } from "../../utils/serviceCodes.js";
import { OFFERED_MODES, MOVEMENT_SCOPES } from "../../utils/movement.js";

/**
 * Query Management — request schemas (CRM_MASTER §5.6/§5.6a, RULE-QRY).
 *
 * A query is a plain enquiry: who is asking, where the goods move from and to, and
 * which services they want. The service-package / CRO / LC dimension and the whole
 * port + cargo block were removed — the quotation and shipment carry that now, so
 * there is nothing left to cross-validate and no refinements here.
 *
 * `services` is free text. SERVICE_CODES is still offered to the UI as the suggested
 * list, but a caller may send anything.
 */

// Re-exported for callers that used to import it from here (storefront.validation.js).
export { SERVICE_CODES, OFFERED_MODES, MOVEMENT_SCOPES };

const baseQueryFields = {
  // Optional on the wire: portal users are scoped to their own customer, which the
  // controller supplies from req.user.customerId. Internal callers must pass it —
  // enforced in the controller, which is where the actor is known.
  customerId: z.string().min(1).optional(),
  // ...or mint one inline. A BDO taking a call from a company we do not serve yet should
  // not have to leave the query form to create the customer first. Mutually exclusive
  // with customerId, and refused for portal users — they are scoped to their own customer.
  newCustomer: z
    .object({
      companyName: z.string().min(2, "Enter the company name").max(200),
      country: z.string().max(100).optional(),
    })
    .optional(),
  // Contact snapshot. Optional on the wire: the controller falls back to the linked
  // Customer when a field is omitted, so the portal, storefront and LC-conversion
  // paths need not repeat what we already know. Shape-checked whenever they ARE sent.
  customerName: z.string().min(1).max(200).optional(),
  customerEmail: z.string().email("Enter a valid email address").max(200).optional(),
  customerPhone: z.string().min(1).max(50).optional(),
  pickupAddress: z.string().min(1, "A pickup address is required").max(500),
  destinationAddress: z.string().min(1, "A destination address is required").max(500),
  /**
   * How far the goods go and how they travel. Required on a new query even though the
   * columns are nullable: the column is nullable so pre-existing rows stay honest about
   * never having been asked, but there is no reason for a query raised today to omit it,
   * and every downstream default (quote template, vendor shortlist) reads these.
   */
  scope: z.enum(MOVEMENT_SCOPES, { error: "Choose domestic, export or import" }),
  modes: z
    .array(z.enum(OFFERED_MODES))
    .min(1, "Select at least one transport mode")
    .max(OFFERED_MODES.length),
  services: z.array(z.string().min(1).max(100)).min(1, "Select at least one service").max(20),
};

export const createQuerySchema = z
  .object(baseQueryFields)
  .refine((v) => !(v.customerId && v.newCustomer), {
    path: ["newCustomer"],
    message: "Pick an existing customer or add a new one — not both",
  });

// Editable while `open`; never status, never the customer it belongs to.
export const updateQuerySchema = z
  .object(baseQueryFields)
  .omit({ customerId: true, newCustomer: true })
  .partial();

export const cancelQuerySchema = z.object({
  reason: z.string().min(3, "A cancellation reason is required (RULE-QRY-03)"),
});
