import { useEffect, useRef, useState } from "react";
import { FileText, Upload, Download, Trash2, Globe, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { useDocumentStore } from "@/store/documentStore";
import { DOC_TYPE_OPTIONS, DOC_TYPE_LABELS, downloadDocument } from "@/services/documentService";

const prettyType = (code) => code?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Doc types a portal customer may send IN — mirrors CUSTOMER_UPLOADABLE_DOC_TYPES in
 * erp-backend/modules/document/document.middleware.js, which is the real gate. Kept in
 * sync by convention; the server rejects anything else with a 403.
 */
const PORTAL_UPLOADABLE_DOC_TYPES = ["cro", "commercial_invoice", "packing_list", "authority_letterhead"];

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
 */
const DocumentsPanel = ({ ownerType, ownerId, showRequired = false, portal = false, locked = false, allowUpload = false }) => {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { documents, checklist, loading, busy, fetch, upload, publish, remove } = useDocumentStore();
  // Portal uploads default to the CRO — the reason a customer is uploading at all.
  const [docType, setDocType] = useState(portal ? "cro" : "other");
  const fileRef = useRef(null);

  useEffect(() => {
    if (ownerType && ownerId) fetch(ownerType, ownerId, { withRequired: showRequired });
  }, [ownerType, ownerId, showRequired, fetch]);

  const docTypeOptions = portal
    ? DOC_TYPE_OPTIONS.filter((o) => PORTAL_UPLOADABLE_DOC_TYPES.includes(o.value))
    : DOC_TYPE_OPTIONS;

  const canUpload = !locked && hasPermission("document.upload") && (!portal || allowUpload);
  const canPublish = !portal && hasPermission("document.publish");
  const canDelete = !portal && !locked && hasPermission("document.delete");

  const onUpload = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Choose a file first");
    try {
      await upload({ file, docType });
      toast.success("Document uploaded");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      toast.error(err?.message || "Couldn't upload the document");
    }
  };

  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
    } catch (err) {
      toast.error(err?.message || "Couldn't update the document");
    }
  };

  const anyMissing = checklist.some((s) => s.missing.length > 0);

  return (
    <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> Documents</h2>

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
                      {missing ? "⚠ " : "✓ "}{DOC_TYPE_LABELS[t] ?? t}
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
            <div className="w-44">
              <Select value={docType} onValueChange={setDocType} items={docTypeOptions.map((o) => ({ value: o.value, label: o.label }))}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {docTypeOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="sm" className="h-9 gap-1.5" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload
            </Button>
          </div>
        </form>
      )}

      {/* List */}
      {loading && <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      {!loading && documents.length === 0 && (
        <p className="text-sm text-muted-foreground">{portal ? "No documents shared yet." : "No documents attached."}</p>
      )}
      <ul className="divide-y">
        {documents.map((d) => (
          <li key={d.id} className="py-2.5 flex items-center gap-3">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{d.fileName}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {d.docType && <Badge variant="secondary" className="text-[10px]">{DOC_TYPE_LABELS[d.docType] ?? d.docType}</Badge>}
                <span className="text-[10px] text-muted-foreground">{kb(d.sizeBytes)}</span>
                {d.isPublished && <Badge variant="outline" className="text-[10px] border-green-400 text-green-700 dark:text-green-300 gap-0.5"><Globe className="w-2.5 h-2.5" /> Portal</Badge>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => downloadDocument(d.id, d.fileName)}>
                <Download className="w-3.5 h-3.5" /> Get
              </Button>
              {canPublish && !d.isPublished && (
                <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" disabled={busy}
                  onClick={() => act(() => publish(d.id), "Published to portal")}>
                  <Globe className="w-3.5 h-3.5" /> Publish
                </Button>
              )}
              {canDelete && (
                <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" disabled={busy}
                  onClick={() => act(() => remove(d.id), "Document deleted")}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default DocumentsPanel;
