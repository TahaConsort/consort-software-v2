/**
 * reportService.js — Reports (CRM_MASTER §5.18). Role-scoped read aggregations;
 * JSON for the screen, CSV for download. Revenue is Finance/Management only.
 */
import api from "@/lib/axios";

// key → { label, revenueOnly }. Order drives the tab bar.
export const REPORTS = [
  { key: "leads", label: "Leads funnel" },
  { key: "shipments", label: "Shipments" },
  { key: "revenue", label: "Revenue", revenueOnly: true },
  { key: "tasks", label: "Tasks" },
  { key: "outreach", label: "Outreach" },
  { key: "unserved-demand", label: "Unserved demand" },
];

export const getReport = async (key, params = {}) => {
  const q = new URLSearchParams(params).toString();
  const res = await api.get(`/reports/${key}${q ? `?${q}` : ""}`);
  return res.data;
};

// Streams a CSV and triggers a browser download.
export const downloadReport = async (key, params = {}) => {
  const q = new URLSearchParams({ ...params, format: "csv" }).toString();
  const res = await api.get(`/reports/${key}?${q}`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${key}-report.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
