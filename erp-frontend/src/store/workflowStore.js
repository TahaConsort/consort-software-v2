import * as workflowService from "@/services/workflowService";
import * as documentService from "@/services/documentService";
import { DOC_TYPE_LABELS } from "@/services/documentService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Workflow vocabulary store (ADR-051) — the admin-managed docType list, consumed
 * wherever an upload picker or a docType label renders. The static DOC_TYPE_LABELS
 * map stays as the fallback for codes that predate the table (and for the moment
 * before hydration).
 *
 * This used to be a permanent one-shot latch: `if (docTypesLoaded) return`, with no
 * invalidator anywhere. An admin adding or renaming a document type left every open
 * client — including the admin's own — showing the old vocabulary for the life of
 * the tab. It now owns the `workflow` topic, so the admin screen's own CRUD and
 * another admin's edits both reach it.
 *
 * Reads /documents/types rather than /workflow/doc-types on purpose: the vocabulary
 * is needed wherever an upload button renders, portal included, and only the former
 * is free of the `workflow.manage` permission.
 */
export const useWorkflowStore = createResourceStore({
  name: "workflow",
  topics: [TOPICS.WORKFLOW],

  state: {
    docTypes: [], // [{ code, label, customerUploadable }]
  },

  load: async () => {
    const res = await documentService.listDocTypes();
    return { docTypes: res.data ?? [] };
  },

  actions: ({ get, mutate }) => ({
    /**
     * Hydrate once per session. Cheap to call from every consumer's mount effect —
     * the factory collapses concurrent calls and skips a settled fetch.
     */
    fetchDocTypes: () => get().fetch({ ifAbsent: true }),

    /** Forced re-read, for after the admin screen edits the vocabulary. */
    refreshDocTypes: () => get().refetch(),

    /**
     * NOTE for consumers: this is a store METHOD, so its identity never changes. A
     * component that selects only `labelForDocType` will therefore never re-render
     * when `docTypes` hydrates and will show raw codes forever — subscribe to
     * `docTypes` as well, even if you don't read it directly.
     */
    labelForDocType: (code) => {
      if (!code) return "";
      const hit = get().docTypes.find((t) => t.code === code);
      return hit?.label ?? DOC_TYPE_LABELS[code] ?? String(code).replace(/_/g, " ");
    },

    /** Picker options, portal-filtered by the same flag the server enforces. */
    docTypeOptions: (portal = false) => {
      const rows = get().docTypes;
      const usable = portal ? rows.filter((t) => t.customerUploadable) : rows;
      return usable.map((t) => ({ value: t.code, label: t.label }));
    },

    /* ── Admin CRUD (management only). Each publishes `workflow`, which is what
       makes another admin's screen and every picker in this tab re-read. ── */

    createDocType: (payload) =>
      mutate(() => workflowService.createDocType(payload), { invalidates: [TOPICS.WORKFLOW] }),

    updateDocType: (code, payload) =>
      mutate(() => workflowService.updateDocType(code, payload), { invalidates: [TOPICS.WORKFLOW] }),

    deleteDocType: (code) =>
      mutate(() => workflowService.deleteDocType(code), { invalidates: [TOPICS.WORKFLOW] }),

    createStep: (payload) =>
      mutate(() => workflowService.createStep(payload), { invalidates: [TOPICS.WORKFLOW] }),

    updateStep: (stepCode, payload) =>
      mutate(() => workflowService.updateStep(stepCode, payload), { invalidates: [TOPICS.WORKFLOW] }),

    deleteStep: (stepCode) =>
      mutate(() => workflowService.deleteStep(stepCode), { invalidates: [TOPICS.WORKFLOW] }),

    replaceActions: (stepCode, actions) =>
      mutate(() => workflowService.replaceActions(stepCode, actions), { invalidates: [TOPICS.WORKFLOW] }),
  }),
});
