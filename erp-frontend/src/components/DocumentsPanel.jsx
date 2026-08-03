import { useEffect, useRef, useState } from "react";
import { FileText, Upload, Download, Trash2, Globe, Loader2, CheckCircle2, AlertTriangle, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { useDocumentStore } from "@/store/documentStore";
import { useWorkflowStore } from "@/store/workflowStore";
import { DOC_TYPE_OPTIONS, downloadDocument, previewDocumentUrl } from "@/services/documentService";

const prettyType = (code) => code?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const EMPTY = [];

/**
 * One uploaded file as a thumbnail (gallery mode).
 *
 * Master-data paperwork is looked at, not read: you open a driver to check the CNIC
 * scan is the right card and the licence has not expired. A row of file names makes
 * you download every one to find out. So images render inline and PDFs render their
 * first page in an inert iframe; anything a browser cannot draw keeps an icon.
 *
 * The bytes need the bearer token, so each card fetches its own blob and revokes the
 * object URL on unmount — a dialog opened ten times would otherwise pin ten copies
 * of every scan in memory until the tab closed.
 */
// Phone-camera scans run to 15–20 MB, and there is no server-side thumbnailer — the
// preview route streams the original file. Auto-loading those would spend ~20 MB to
// draw a 150px card, so anything above this asks first.
const PREVIEW_AUTO_LIMIT = 3 * 1024 * 1024;

const DocumentCard = ({ doc, label, canDelete, busy, onDelete }) => {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [asked, setAsked] = useState(false); // user tapped "Preview" on a heavy file
  const isImage = doc.mimeType?.startsWith("image/");
  const isPdf = doc.mimeType === "application/pdf";
  const previewable = isImage || isPdf;
  const heavy = doc.sizeBytes > PREVIEW_AUTO_LIMIT;
  const wanted = previewable && (!heavy || asked);

  useEffect(() => {
    if (!wanted) return undefined;
    let cancelled = false;
    let objectUrl = null;
    previewDocumentUrl(doc.id)
      .then((u) => {
        // Unmounted mid-flight: revoke immediately rather than hand it to dead state.
        if (cancelled) return URL.revokeObjectURL(u);
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id, wanted]);

  return (
    <div className="group relative rounded-lg border overflow-hidden bg-muted/30">
      <div className="aspect-4/3 flex items-center justify-center overflow-hidden bg-muted/50">
        {isImage && url && (
          <img src={url} alt={label || doc.fileName} className="w-full h-full object-cover" />
        )}
        {isPdf && url && (
          // pointer-events-none: the thumbnail is a picture of the document, not a
          // reader — clicks belong to the card's own View action.
          <iframe
            src={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            title={doc.fileName}
            className="w-full h-full pointer-events-none border-0"
          />
        )}
        {wanted && !url && !failed && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {previewable && heavy && !asked && !failed && (
          <button type="button" onClick={() => setAsked(true)}
            className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <Eye className="w-6 h-6" />
            <span className="text-[10px]">Preview ({kb(doc.sizeBytes)})</span>
          </button>
        )}
        {(!previewable || failed) && (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <FileText className="w-7 h-7" />
            <span className="text-[10px] uppercase tracking-wide">
              {failed ? "No preview" : (doc.fileName?.split(".").pop() || "file")}
            </span>
          </div>
        )}
      </div>

      <div className="p-2 space-y-1">
        {/* The doc TYPE leads — "CNIC (National ID)" is what someone is looking for;
            the file name is the storage detail, kept as the hover title. */}
        <p className="text-xs font-medium truncate" title={doc.fileName}>{label || doc.fileName}</p>
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] text-muted-foreground">{kb(doc.sizeBytes)}</span>
          <div className="flex items-center gap-0.5">
            {url && (
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1"
                onClick={() => window.open(url, "_blank", "noopener")}>
                <Eye className="w-3 h-3" /> View
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1"
              onClick={() => downloadDocument(doc.id, doc.fileName)}>
              <Download className="w-3 h-3" />
            </Button>
            {canDelete && (
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-destructive" disabled={busy} onClick={onDelete}>
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Reusable documents panel (CRM_MASTER §5.13). Internal mode shows the RULE-SH-06
 * required-doc checklist + upload/publish/delete. Portal mode shows the published
 * documents a customer may download (INV-10/§2.2) and — when `allowUpload` is set —
 * lets them send in their own paperwork, most importantly a CRO they are supplying
 * themselves. A customer can never publish or delete.
 *
 * `locked` freezes the paperwork of a finished order (RULE-SH-12) — publishing
 * stays available, since revealing a document to the customer changes nothing
 * about what happened.
 *
 * `onChanged` fires after every successful mutation, for a parent that keeps state
 * this panel cannot reach through the topic bus — the customer portal's dashboard
 * cards, for instance. A parent that owns the `shipment:{id}` topic must NOT pass it:
 * documentStore already publishes that topic, so it would refetch twice.
 */
// `bare` drops the card chrome (border, shadow, own padding, own heading) for a panel
// that is ALREADY inside one — a dialog. Nested cards cost ~40px of width the file
// names then have to truncate out of, and the dialog title already says "Documents".
// `gallery` swaps the file-name list for thumbnails (see DocumentCard). Opt-in, because
// a shipment's paperwork is a checklist you scan by name against RULE-SH-06, while a
// driver's folder is three pictures you recognise on sight.
const DocumentsPanel = ({ ownerType, ownerId, showRequired = false, portal = false, locked = false, allowUpload = false, allowPublish = true, bare = false, gallery = false, defaultDocType, onChanged }) => {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const docStore = useDocumentStore();
  const { loading, refreshing, busy, fetch, upload, publish, remove } = docStore;
  // The store is one singleton serving this panel and the portal dialog. Rendering
  // its rows without checking the owner is how shipment A's filenames ended up under
  // shipment B's header; keep the guard even though only one panel mounts today.
  const mine = docStore.ownerType === ownerType && docStore.ownerId === ownerId;
  const documents = mine ? docStore.documents : EMPTY;
  const checklist = mine ? docStore.checklist : EMPTY;

  // Subscribing to `docTypes` is required, not incidental: labelForDocType is a store
  // method with a stable identity, so selecting it alone would never re-render this
  // panel when the vocabulary hydrates and every label would stay a raw code.
  const { docTypes, fetchDocTypes, labelForDocType, docTypeOptions: optionsFor } = useWorkflowStore();
  // Portal uploads default to the CRO — the reason a customer is uploading at all.
  // `defaultDocType` lets a master-data panel open on the type people actually came
  // to attach (a driver's CNIC), instead of making them re-pick it every time.
  const [docType, setDocType] = useState(defaultDocType ?? (portal ? "cro" : "other"));
  const fileRef = useRef(null);

  useEffect(() => {
    // `ifAbsent` so a parent that already loaded this owner (the shipment page needs
    // the checklist before this panel even renders) doesn't pay for a second request.
    if (ownerType && ownerId) fetch(ownerType, ownerId, { withRequired: showRequired, ifAbsent: true });
  }, [ownerType, ownerId, showRequired, fetch]);
  useEffect(() => { fetchDocTypes(); }, [fetchDocTypes]);

  // Admin-managed vocabulary (ADR-051), static list as pre-hydration fallback. The
  // portal filter is the customerUploadable flag — the same gate the server enforces
  // (the fallback allowlist mirrors the factory seed for the moment before hydration).
  const FALLBACK_PORTAL_TYPES = ["cro", "lc", "commercial_invoice", "packing_list", "authority_letterhead"];
  const serverOptions = optionsFor(portal);
  const docTypeOptions = docTypes.length
    ? serverOptions
    : (portal ? DOC_TYPE_OPTIONS.filter((o) => FALLBACK_PORTAL_TYPES.includes(o.value)) : DOC_TYPE_OPTIONS);

  const canUpload = !locked && hasPermission("document.upload") && (!portal || allowUpload);
  // `allowPublish` is off for owners that have no portal audience at all (a driver,
  // a truck). The server refuses those too — this only keeps a button that could
  // never do anything useful off the screen.
  const canPublish = allowPublish && !portal && hasPermission("document.publish");
  const canDelete = !portal && !locked && hasPermission("document.delete");

  const onUpload = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Choose a file first");
    try {
      const res = await upload({ file, docType, ownerType, ownerId });
      toast.success("Document uploaded");
      if (fileRef.current) fileRef.current.value = "";
      onChanged?.({ action: "upload", document: res?.data });
    } catch (err) {
      toast.error(err?.message || "Couldn't upload the document");
    }
  };

  const act = async (fn, msg, action) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      onChanged?.({ action, document: res?.data });
    } catch (err) {
      toast.error(err?.message || "Couldn't update the document");
    }
  };

  const anyMissing = checklist.some((s) => s.missing.length > 0);

  return (
    <div className={bare ? "space-y-4 min-w-0" : "border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5 space-y-4"}>
      {!bare && <h2 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> Documents</h2>}

      {/* Required-doc checklist (RULE-SH-06) */}
      {showRequired && checklist.length > 0 && (
        <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
          <p className="text-xs font-medium flex items-center gap-1.5">
            {anyMissing ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> : <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
            Required legal documents
          </p>
          <ul className="space-y-1">
            {checklist.map((s) => (
              <li key={s.stepCode} className="text-xs flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground">{s.displayNo}. {prettyType(s.stepCode)}:</span>
                {s.required.map((t) => {
                  const missing = s.missing.includes(t);
                  return (
                    <Badge key={t} variant="outline"
                      className={`text-[10px] ${missing ? "border-amber-400 text-amber-700 dark:text-amber-300" : "border-green-400 text-green-700 dark:text-green-300"}`}>
                      {missing ? "⚠ " : "✓ "}{labelForDocType(t)}
                    </Badge>
                  );
                })}
              </li>
            ))}
          </ul>
          {anyMissing && <p className="text-[11px] text-amber-600">A step cannot be completed until its required document is attached.</p>}
        </div>
      )}

      {/* Upload */}
      {canUpload && (
        <form onSubmit={onUpload} className="space-y-2">
          {portal && (
            <p className="text-xs text-muted-foreground">
              Send us a document — your Container Release Order, or your own trade paperwork.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[140px]">
              <input ref={fileRef} type="file" className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-white file:text-xs hover:file:bg-primary/90" />
            </div>
            <div className="w-44 min-w-0">
              {/* w-full on the trigger: it is `w-fit whitespace-nowrap` by default, so a
                  long label ("EIR — Empty Container Pickup") would burst the w-44 box and
                  push the row sideways instead of clamping inside it. */}
              <Select value={docType} onValueChange={setDocType} items={docTypeOptions.map((o) => ({ value: o.value, label: o.label }))}>
                <SelectTrigger className="h-9 w-full text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {docTypeOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="sm" className="h-9 gap-1.5" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload
            </Button>
          </div>
          {/* The server restates the filename after the chosen type — say so, or the
              scan someone just sent as IMG_0043.pdf comes back looking like a
              different file than the one they picked. */}
          {docType !== "other" && (
            <p className="text-[11px] text-muted-foreground">
              Saved as <span className="font-medium">{labelForDocType(docType)}</span> — the file is renamed to match the document type.
            </p>
          )}
        </form>
      )}

      {/* List. The spinner is for the FIRST load only — a background refresh must not
          replace content the user is reading, it just dims the list for a moment. */}
      {loading && documents.length === 0 && (
        <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      )}
      {!loading && documents.length === 0 && (
        <p className="text-sm text-muted-foreground">{portal ? "No documents shared yet." : "No documents attached."}</p>
      )}
      {gallery ? (
        <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 transition-opacity ${refreshing ? "opacity-60" : ""}`}>
          {documents.map((d) => (
            <DocumentCard
              key={d.id}
              doc={d}
              label={d.docType ? labelForDocType(d.docType) : null}
              canDelete={canDelete}
              busy={busy}
              onDelete={() => act(() => remove(d.id), "Document deleted", "remove")}
            />
          ))}
        </div>
      ) : (
      <ul className={`divide-y transition-opacity ${refreshing ? "opacity-60" : ""}`}>
        {documents.map((d) => (
          <li key={d.id} className="py-2.5 flex items-center gap-3">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{d.fileName}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {d.docType && <Badge variant="secondary" className="text-[10px]">{labelForDocType(d.docType)}</Badge>}
                <span className="text-[10px] text-muted-foreground">{kb(d.sizeBytes)}</span>
                {d.isPublished && <Badge variant="outline" className="text-[10px] border-green-400 text-green-700 dark:text-green-300 gap-0.5"><Globe className="w-2.5 h-2.5" /> Portal</Badge>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => downloadDocument(d.id, d.fileName)}>
                <Download className="w-3.5 h-3.5" /> Get
              </Button>
              {canPublish && !d.isPublished && (
                <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" disabled={busy}
                  onClick={() => act(() => publish(d.id), "Published to portal", "publish")}>
                  <Globe className="w-3.5 h-3.5" /> Publish
                </Button>
              )}
              {canDelete && (
                <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" disabled={busy}
                  onClick={() => act(() => remove(d.id), "Document deleted", "remove")}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
};

export default DocumentsPanel;
