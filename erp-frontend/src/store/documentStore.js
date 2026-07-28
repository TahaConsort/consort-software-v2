import { create } from "zustand";
import * as documentService from "@/services/documentService";

/**
 * Document store (CRM_MASTER §5.13). Documents + the RULE-SH-06 required-doc
 * checklist for one owner (usually a shipment). Server is the source of truth —
 * every mutation refetches both lists.
 */
export const useDocumentStore = create((set, get) => ({
  ownerType: null,
  ownerId: null,
  documents: [],
  checklist: [], // [{ displayNo, stepCode, status, required, missing }]
  loading: false,
  busy: false,
  error: null,

  fetch: async (ownerType, ownerId, { withRequired = false } = {}) => {
    set({ loading: true, error: null, ownerType, ownerId });
    try {
      const docsRes = await documentService.listDocuments(ownerType, ownerId);
      let checklist = [];
      if (withRequired && ownerType === "shipment") {
        const reqRes = await documentService.requiredDocs(ownerId);
        checklist = reqRes.data?.checklist ?? [];
      }
      set({ documents: docsRes.data ?? [], checklist, loading: false });
    } catch (err) {
      set({ error: err?.message || "Failed to load documents", loading: false });
    }
  },

  refetch: async () => {
    const { ownerType, ownerId } = get();
    if (ownerType && ownerId) await get().fetch(ownerType, ownerId, { withRequired: ownerType === "shipment" });
  },

  upload: async ({ file, docType }) => {
    set({ busy: true });
    try {
      const res = await documentService.uploadDocument({ file, ownerType: get().ownerType, ownerId: get().ownerId, docType });
      await get().refetch();
      return res;
    } finally {
      set({ busy: false });
    }
  },

  publish: async (id) => {
    set({ busy: true });
    try {
      const res = await documentService.publishDocument(id);
      await get().refetch();
      return res;
    } finally {
      set({ busy: false });
    }
  },

  remove: async (id, reason) => {
    set({ busy: true });
    try {
      const res = await documentService.deleteDocument(id, reason);
      await get().refetch();
      return res;
    } finally {
      set({ busy: false });
    }
  },
}));
