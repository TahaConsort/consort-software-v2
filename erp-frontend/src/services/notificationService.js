/**
 * notificationService.js — in-app notifications (CRM_MASTER §5.15),
 * written by the backend outbox relay.
 */
import api from "@/lib/axios";

// GET /notifications → { data, unreadCount }
export const listNotifications = async () => {
  const res = await api.get("/notifications");
  return res.data;
};

export const markRead = async (id) => {
  const res = await api.patch(`/notifications/${id}/read`);
  return res.data;
};

export const markAllRead = async () => {
  const res = await api.post("/notifications/read-all");
  return res.data;
};

// Per-type/channel preferences (RULE-NT-01 — task.assigned & shipment.held are mandatory).
export const getPreferences = async () => {
  const res = await api.get("/notifications/preferences");
  return res.data;
};

export const updatePreferences = async (preferences) => {
  const res = await api.put("/notifications/preferences", { preferences });
  return res.data;
};
