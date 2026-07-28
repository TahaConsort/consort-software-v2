/**
 * OTC access + scope (CRM_MASTER §5.10, BUSINESS_RULES §2.2/2.3).
 *
 * OTC milestones are a sub-resource of a shipment. READ visibility is the
 * shipment's own scope (a milestone is visible iff its shipment is in scope),
 * so this re-uses the shipment scope helpers (ADR-001). WRITING a milestone is
 * additionally gated by the `otc.update` permission on the route (Accounts /
 * Management only, RULE-FI-04).
 */
export {
  requireShipmentAccess as requireOtcAccess,
  attachShipmentScope,
  shipmentInScope,
} from "../shipment/shipment.middleware.js";
