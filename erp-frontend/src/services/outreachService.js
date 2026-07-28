/**
 * outreachService.js — Outreach module (CRM_MASTER §5.5).
 * Touches on leads AND customers, plus the follow-ups-due dashboard feed.
 */
import api from "@/lib/axios";

// GET /outreach?target=lead|customer
export const listOutreach = async (target) => {
  const res = await api.get(`/outreach${target ? `?target=${target}` : ""}`);
  return res.data;
};

// POST /outreach — target exactly one of { leadId, customerId }
export const createOutreach = async (payload) => {
  const res = await api.post("/outreach", payload);
  return res.data;
};

// GET /outreach/follow-ups-due → { data: [{...row, bucket}], counts }
export const getFollowUpsDue = async () => {
  const res = await api.get("/outreach/follow-ups-due");
  return res.data;
};
