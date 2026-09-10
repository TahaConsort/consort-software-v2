import { useAuthStore } from "@/store/authStore";
import ShipmentDetailPage from "./ShipmentDetailPage";
import ShipmentStatusPage from "./ShipmentStatusPage";

/**
 * Which shipment screen a viewer gets.
 *
 * Keyed on CAPABILITY, not on a role name. Every role that can reach a shipment holds
 * `shipment.read`; what separates them is whether they can change anything. Sales roles
 * (BDO, ASM) hold none of the writes below, so the management screen only ever showed
 * them a stepper with every button hidden — they get the read-only status page instead.
 *
 * Doing this by capability rather than by `role === "bdo"` matters for two cases the
 * name check gets wrong: a user holding BDO *and* an ops role still needs the full
 * screen, and Management (whose permission set carries all of these) is covered without
 * a special case.
 */
const SHIPMENT_WRITE_PERMISSIONS = [
  "shipment.claim",
  "shipment.assign",
  "shipment.schedule",
  "shipment.hold",
  "shipment.resume",
  "shipment.cancel",
  "shipment.close",
  "shipment.step.complete",
  "shipment.step.reopen",
];

const ShipmentRoute = () => {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = SHIPMENT_WRITE_PERMISSIONS.some((p) => hasPermission(p));
  return canManage ? <ShipmentDetailPage /> : <ShipmentStatusPage />;
};

export default ShipmentRoute;
