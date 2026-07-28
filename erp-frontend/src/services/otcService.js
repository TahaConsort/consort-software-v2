/**
 * otcService.js — OTC, Order to Cash (CRM_MASTER §5.10). Five milestones at
 * /api/otc. Milestones 1–2 complete automatically from Finance (invoice issue &
 * full payment, RULE-FI-02/03); 3–5 are recorded manually, in order (RULE-FI-04).
 * All five done + delivered → the shipment derives to `settled` (RULE-SH-12).
 */
import api from "@/lib/axios";

export const getMilestones = async (shipmentId) => {
  const res = await api.get(`/otc/${shipmentId}/milestones`);
  return res.data;
};

export const completeMilestone = async (shipmentId, milestoneNo, notes) => {
  const res = await api.post(`/otc/${shipmentId}/milestones/${milestoneNo}/complete`, notes ? { notes } : {});
  return res.data;
};
