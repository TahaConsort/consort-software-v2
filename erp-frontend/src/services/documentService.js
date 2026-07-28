/**
 * documentService.js — Documents (CRM_MASTER §5.13, RULE-DOC). Polymorphic
 * ownership; internal by default (INV-10). Legal documents attached to a
 * shipment gate OTD step completion (RULE-SH-06). Upload needs multer on the
 * backend (installed manually — 503 until then).
 */
import api from "@/lib/axios";

export const DOC_TYPE_OPTIONS = [
  { value: "gd", label: "GD / Customs Declaration" },
  { value: "bol", label: "Bill of Lading (BOL)" },
  { value: "pod", label: "Proof of Delivery (POD)" },
  { value: "invoice", label: "Invoice" },
  { value: "packing_list", label: "Packing List" },
  { value: "commercial_invoice", label: "Commercial Invoice" },
  { value: "sales_tax_invoice", label: "Sales Tax Invoice" },
  { value: "certificate_of_origin", label: "Certificate of Origin" },
  { value: "authority_letterhead", label: "Authority Letterhead" },
  { value: "undertaking", label: "Undertaking" },
  { value: "quotation", label: "Quotation" },
  { value: "lc", label: "Letter of Credit / SWIFT Advice" },
  { value: "cro", label: "Container Release Order (CRO)" },
  { value: "inspection_cert", label: "Inspection & Seal Certificate" },
  { value: "bank_receipt", label: "Bank Submission Receipt" },
  { value: "telex", label: "Telex Release Confirmation" },
  { value: "eir_out", label: "EIR — Empty Container Pickup" },
  { value: "eir_in", label: "EIR — Port Gate-In" },
  { value: "eir_pickup", label: "EIR — Destination Pickup" },
  { value: "eir_empty_return", label: "EIR — Empty Return" },
  { value: "delivery_order", label: "Delivery Order (DO)" },
  { value: "gate_pass", label: "Gate Pass" },
  { value: "proof", label: "Proof / Evidence" },
  { value: "other", label: "Other" },
];

export const DOC_TYPE_LABELS = Object.fromEntries(DOC_TYPE_OPTIONS.map((o) => [o.value, o.label]));

export const listDocuments = async (ownerType, ownerId) => {
  const res = await api.get(`/documents?ownerType=${ownerType}&ownerId=${ownerId}`);
  return res.data;
};

export const requiredDocs = async (shipmentId) => {
  const res = await api.get(`/documents/required/${shipmentId}`);
  return res.data;
};

export const uploadDocument = async ({ file, ownerType, ownerId, docType, otdStepId }) => {
  const form = new FormData();
  form.append("file", file);
  form.append("ownerType", ownerType);
  form.append("ownerId", ownerId);
  if (docType) form.append("docType", docType);
  if (otdStepId) form.append("otdStepId", otdStepId); // group under a specific step
  // Content-Type undefined → the browser sets multipart/form-data + boundary.
  const res = await api.post("/documents", form, { headers: { "Content-Type": undefined } });
  return res.data;
};

export const publishDocument = async (id) => {
  const res = await api.post(`/documents/${id}/publish`);
  return res.data;
};

export const deleteDocument = async (id, reason) => {
  const res = await api.delete(`/documents/${id}`, { data: reason ? { reason } : {} });
  return res.data;
};

// Streams the file as a blob and triggers a browser download (audited server-side).
export const downloadDocument = async (id, fileName) => {
  const res = await api.get(`/documents/${id}/download`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "document";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
