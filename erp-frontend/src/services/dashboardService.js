/**
 * dashboardService.js — the single role-aware dashboard endpoint (§5.17).
 * The payload shape depends on the caller's role.
 */
import api from "@/lib/axios";

export const getDashboard = async () => {
  const res = await api.get("/dashboard");
  return res.data;
};
