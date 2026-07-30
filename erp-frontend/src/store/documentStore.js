import * as documentService from "@/services/documentService";
import { createResourceStore } from "@/lib/createResourceStore";
import { documentsTopic, shipmentTopic, TOPICS } from "@/lib/topics";


/**
 * Document store (CRM_MASTER §5.13). Documents + the RULE-SH-06 required-doc
 * checklist for one owner (usually a shipment).
 *
 * A document change is never only a document change: a `document` step sub-action's
 * `satisfied` and the required-doc miss set are both DERIVED server-side from the
 * files on record at read time (shipment.service.js withStepActions). So an upload
 * silently changes whether a step can be completed, with nothing in the upload
 * response to say so. That is why every mutation here invalidates the owning
 * shipment as well as this list — without it, attaching the missing document left
 * the Complete button disabled until the user reloaded.
 */
export const useDocumentStore = createResourceStore({
  name: "documents",
  topicOf: (s) => (s.ownerType && s.ownerId ? [documentsTopic(s.ownerType, s.ownerId)] : []),

  state: {
    ownerType: null,
    ownerId: null,
    withRequired: false, // remembered, so refetch() reproduces the caller's intent
    documents: [],
    checklist: [], // [{ displayNo, stepCode, status, required, missing }]
  },

  // The checklist is a separate request, so it belongs in the identity: a panel that
  // wants it must not be served a cached list that was fetched without it.
  keyOf: ([ownerType, ownerId, opts]) =>
    ownerType && ownerId ? `${ownerType}:${ownerId}:${opts?.withRequired ? 1 : 0}` : null,

  // A different owner must not show the previous owner's files for even one frame.
  clearOnKeyChange: { documents: [], checklist: [] },

  load: async ({ args }) => {
    const [ownerType, ownerId, opts = {}] = args;
    const withRequired = !!opts.withRequired;

    // Settled independently: the checklist is advisory, and when both shared one
    // try/catch a failing checklist call skipped the `set` entirely — leaving the
    // pre-upload list on screen with no clue anything had happened.
    const [docsRes, reqRes] = await Promise.allSettled([
      documentService.listDocuments(ownerType, ownerId),
      withRequired && ownerType === "shipment"
        ? documentService.requiredDocs(ownerId)
        : Promise.resolve(null),
    ]);

    if (docsRes.status === "rejected") throw docsRes.reason;

    const patch = {
      ownerType,
      ownerId,
      withRequired,
      documents: docsRes.value?.data ?? [],
    };
    if (reqRes.status === "fulfilled") patch.checklist = reqRes.value?.data?.checklist ?? [];
    return patch;
  },

  actions: ({ get, mutate }) => {
    /**
     * Topics a write here dirties — the shipment because it carries the step gating.
     * Deliberately NOT this store's own `documents:…` topic: `mutate` already
     * refetches it, and there is one store instance serving every panel, so
     * publishing it would only buy a duplicate request.
     */
    const touched = () => {
      const { ownerType, ownerId } = get();
      if (ownerType !== "shipment") return [];
      return [shipmentTopic(ownerId), TOPICS.SHIPMENTS, TOPICS.DASHBOARD];
    };

    return {
      /**
       * `ownerType`/`ownerId` are overridable so a step-scoped caller cannot silently
       * upload to whichever owner a panel happened to leave in the store.
       * `otdStepId` groups the file under a step (it does not affect gating — the
       * server gates on docType alone).
       */
      upload: ({ file, docType, otdStepId, ownerType, ownerId } = {}) => {
        const oT = ownerType ?? get().ownerType;
        const oI = ownerId ?? get().ownerId;
        if (!oT || !oI) throw new Error("No document owner selected");
        return mutate(
          () => documentService.uploadDocument({ file, ownerType: oT, ownerId: oI, docType, otdStepId }),
          { invalidates: touched() },
        );
      },

      publish: (id) =>
        mutate(() => documentService.publishDocument(id), { invalidates: touched() }),

      remove: (id, reason) =>
        mutate(() => documentService.deleteDocument(id, reason), { invalidates: touched() }),
    };
  },
});
