/**
 * OTD access + scope (CRM_MASTER §5.9, BUSINESS_RULES §2.2/2.3).
 *
 * OTD steps are a sub-resource of a shipment, so access and row-level scope are
 * exactly the shipment's (RULE-SVC-02: a department only appears on a shipment
 * whose composed path carries one of its steps). To keep ONE source of truth
 * (ADR-001) this module re-exports the shipment scope helpers rather than
 * re-deriving them.
 */
export {
  requireShipmentAccess as requireOtdAccess,
  attachShipmentScope,
  scopedShipmentWhere,
  shipmentInScope,
  getUserDeptCode,
} from "../shipment/shipment.middleware.js";
