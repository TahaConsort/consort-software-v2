import { useEffect, useState } from "react";
import {
  Workflow, Loader2, Plus, Trash2, Pencil, ListChecks, ShieldCheck, Info, Eye, RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";
import { invalidate } from "@/lib/invalidationBus";
import { TOPICS } from "@/lib/topics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as workflowService from "@/services/workflowService";
import * as serviceCatalogService from "@/services/serviceCatalogService";

/**
 * Workflow catalog admin (ADR-051) — Management-only CRUD over the OTD step catalog,
 * per-step checklists and the document-type vocabulary the composition engine reads at
 * quote approval. The one rule to keep in mind everywhere here: edits shape NEW
 * shipments only — a composed path is frozen at approval (INV-14).
 */

const TABS = [
  { key: "steps", label: "Steps" },
  { key: "docTypes", label: "Document Types" },
  { key: "preview", label: "Preview" },
];

const prettyCode = (code) => String(code ?? "").replace(/_/g, " ");

/** Toggleable badge chips — the compact editor for the template gate arrays. */
const ChipToggle = ({ options, value = [], onChange, disabled = false }) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map((o) => {
      const active = value.includes(o.code);
      return (
        <button
          key={o.code}
          type="button"
          disabled={disabled}
          onClick={() => onChange(active ? value.filter((v) => v !== o.code) : [...value, o.code])}
          className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
            active
              ? "bg-primary text-white border-primary"
              : "bg-transparent text-muted-foreground border-border hover:border-primary/50"
          } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          {o.label ?? o.code}
        </button>
      );
    })}
  </div>
);

const GateSummary = ({ step, meta }) => {
  const chips = [];
  if (step.always) chips.push({ text: "always", cls: "border-primary/50 text-primary" });
  (step.packages ?? []).forEach((p) =>
    chips.push({ text: meta?.packages.find((x) => x.code === p)?.label ?? p, cls: "" }),
  );
  (step.croModes ?? []).forEach((m) => chips.push({ text: `CRO: ${m}`, cls: "border-amber-400 text-amber-700 dark:text-amber-300" }));
  (step.lcModes ?? []).forEach((m) => chips.push({ text: `LC: ${m}`, cls: "border-sky-400 text-sky-700 dark:text-sky-300" }));
  (step.services ?? []).forEach((s) => chips.push({ text: prettyCode(s), cls: "border-violet-400 text-violet-700 dark:text-violet-300" }));
  if (!chips.length) chips.push({ text: "every shipment", cls: "" });
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c, i) => (
        <Badge key={i} variant="outline" className={`text-[10px] ${c.cls}`}>{c.text}</Badge>
      ))}
    </div>
  );
};

export default function WorkflowManagePage() {
  const [tab, setTab] = useState("steps");
  const [meta, setMeta] = useState(null);

  const loadMeta = async () => {
    try {
      const res = await workflowService.getMeta();
      setMeta(res.data);
    } catch (err) {
      toast.error(err?.message || "Could not load workflow metadata");
    }
  };
  useEffect(() => { loadMeta(); }, []);

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Workflow className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Workflow</h1>
            <p className="text-sm text-muted-foreground">
              Steps, checklists and document types per service — the catalog composed onto every new shipment
            </p>
          </div>
        </div>
      </div>

      {/* INV-14 — the one thing every admin must know before editing */}
      <div className="rounded-lg border border-sky-300 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-800 p-3 flex items-start gap-2">
        <Info className="w-4 h-4 text-sky-600 dark:text-sky-300 shrink-0 mt-0.5" />
        <p className="text-xs text-sky-800 dark:text-sky-200">
          Changes apply to <b>new shipments only</b> — existing shipments keep the step path they were
          approved with. A step that has been used on shipments can be deactivated but never deleted.
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "steps" && <StepsTab meta={meta} onMetaChanged={loadMeta} />}
      {tab === "docTypes" && <DocTypesTab onChanged={loadMeta} />}
      {tab === "preview" && <PreviewTab meta={meta} />}
    </div>
  );
}

/* ══════════════════════════ Steps ══════════════════════════ */

const StepsTab = ({ meta, onMetaChanged }) => {
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // {kind:"create"} | {kind:"edit",step} | {kind:"checklist",step} | {kind:"validate"}

  const load = async () => {
    setLoading(true);
    try {
      const res = await workflowService.listSteps();
      setSteps(res.data || []);
    } catch (err) {
      toast.error(err?.message || "Could not load the step catalog");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(okMsg || res?.message || "Saved");
      setDialog(null);
      await load();
      // The page-level `meta` drives the gate chips, this tab's dialog option lists and
      // the Preview tab. It was never refreshed here — the prop was passed but silently
      // destructured away — so all three kept the pre-edit vocabulary until a reload.
      onMetaChanged?.();
      // Step templates shape the docType vocabulary and every consumer of it (ADR-051).
      invalidate(TOPICS.WORKFLOW);
    } catch (err) {
      toast.error(err?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = (step) =>
    act(
      () => workflowService.updateStep(step.stepCode, { active: !step.active }),
      step.active ? `"${step.title}" deactivated — it will no longer compose` : `"${step.title}" reactivated`,
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {steps.length} steps · ordered by canonical number (space new ones by 10s so later inserts fit)
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setDialog({ kind: "validate" })}>
            <ShieldCheck className="w-4 h-4" /> Validate catalog
          </Button>
          <Button className="gap-2" onClick={() => setDialog({ kind: "create" })}>
            <Plus className="w-4 h-4" /> New step
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5">#</th>
                <th className="px-3 py-2.5">Step</th>
                <th className="px-3 py-2.5">Owner</th>
                <th className="px-3 py-2.5">Applies to</th>
                <th className="px-3 py-2.5">Documents</th>
                <th className="px-3 py-2.5">Checklist</th>
                <th className="px-3 py-2.5">Used on</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {steps.map((s) => {
                const used = (s.usage?.shipmentSteps ?? 0) > 0 || (s.usage?.chargeTypes ?? 0) > 0;
                return (
                  <tr key={s.stepCode} className={`hover:bg-muted/30 align-top ${!s.active ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2.5 font-mono text-xs">{s.canonicalNo}</td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{s.title}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{s.stepCode}</p>
                      {!s.active && <Badge variant="outline" className="text-[10px] mt-1">inactive</Badge>}
                    </td>
                    <td className="px-3 py-2.5 capitalize text-xs">{s.ownerDepartment}</td>
                    <td className="px-3 py-2.5"><GateSummary step={s} meta={meta} /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(s.requiredDocTypes ?? []).map((d) => (
                          <Badge key={d} variant="secondary" className="text-[10px]">{prettyCode(d)}</Badge>
                        ))}
                        {!(s.requiredDocTypes ?? []).length && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {s.actions?.length ? `${s.actions.length} item(s)` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {s.usage?.shipmentSteps ? `${s.usage.shipmentSteps} shipment(s)` : "never"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-8" title="Edit step" disabled={busy}
                          onClick={() => setDialog({ kind: "edit", step: s })}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" title="Edit checklist" disabled={busy}
                          onClick={() => setDialog({ kind: "checklist", step: s })}>
                          <ListChecks className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={() => toggleActive(s)}>
                          {s.active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-destructive" disabled={busy || used}
                          title={used ? "Referenced by shipments/charge types — deactivate instead" : "Delete step"}
                          onClick={() => act(() => workflowService.deleteStep(s.stepCode), `"${s.title}" deleted`)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(dialog?.kind === "create" || dialog?.kind === "edit") && meta && (
        <StepDialog
          busy={busy}
          meta={meta}
          step={dialog.step ?? null}
          takenNumbers={steps.map((s) => s.canonicalNo)}
          onClose={() => setDialog(null)}
          onSubmit={(payload) =>
            dialog.kind === "edit"
              ? act(() => workflowService.updateStep(dialog.step.stepCode, payload))
              : act(() => workflowService.createStep(payload))
          }
        />
      )}
      {dialog?.kind === "checklist" && meta && (
        <ChecklistDialog
          busy={busy}
          meta={meta}
          step={dialog.step}
          onClose={() => setDialog(null)}
          onSubmit={(actions) => act(() => workflowService.replaceActions(dialog.step.stepCode, actions))}
        />
      )}
      {dialog?.kind === "validate" && <ValidateDialog onClose={() => setDialog(null)} />}
    </div>
  );
};

const EMPTY_STEP = {
  stepCode: "", canonicalNo: "", title: "", hint: "", ownerDepartment: "", derivedStatus: "",
  dueOffsetHours: "48", always: false, active: true,
  packages: [], croModes: [], lcModes: [], services: [], requiredDocTypes: [],
};

const StepDialog = ({ busy, meta, step, takenNumbers, onClose, onSubmit }) => {
  const editing = !!step;
  const [form, setForm] = useState(
    editing
      ? {
          stepCode: step.stepCode,
          canonicalNo: String(step.canonicalNo),
          title: step.title,
          hint: step.hint ?? "",
          ownerDepartment: step.ownerDepartment,
          derivedStatus: step.derivedStatus,
          dueOffsetHours: String(step.dueOffsetHours),
          always: step.always,
          active: step.active,
          packages: step.packages ?? [],
          croModes: step.croModes ?? [],
          lcModes: step.lcModes ?? [],
          services: step.services ?? [],
          requiredDocTypes: step.requiredDocTypes ?? [],
        }
      : EMPTY_STEP,
  );
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const numberTaken =
    form.canonicalNo !== "" &&
    takenNumbers.includes(Number(form.canonicalNo)) &&
    (!editing || Number(form.canonicalNo) !== step.canonicalNo);

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error("A title is required");
    if (!form.ownerDepartment) return toast.error("Pick the owning department");
    if (!form.derivedStatus) return toast.error("Pick the status this step derives");
    if (form.canonicalNo === "" || Number(form.canonicalNo) < 1) return toast.error("A canonical number is required");
    if (numberTaken) return toast.error(`Canonical number ${form.canonicalNo} is already in use`);
    if (!editing && !/^[a-z][a-z0-9_]{1,49}$/.test(form.stepCode)) {
      return toast.error("Step code must be lowercase snake_case, e.g. fumigation_cert");
    }
    const payload = {
      canonicalNo: Number(form.canonicalNo),
      title: form.title.trim(),
      hint: form.hint.trim() || null,
      ownerDepartment: form.ownerDepartment,
      derivedStatus: form.derivedStatus,
      dueOffsetHours: Number(form.dueOffsetHours) || 48,
      always: form.always,
      active: form.active,
      packages: form.packages,
      croModes: form.croModes,
      lcModes: form.lcModes,
      services: form.services,
      requiredDocTypes: form.requiredDocTypes,
    };
    onSubmit(editing ? payload : { stepCode: form.stepCode, ...payload });
  };

  const activeDocTypes = meta.docTypes.filter((t) => t.active);

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit step — ${step.title}` : "New step"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "The step code is permanent; everything else can change. Applies to new shipments only."
              : "Composes onto every new shipment whose package / CRO / LC / services match the gates below."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wf-code">Step code</Label>
              <Input id="wf-code" value={form.stepCode} disabled={editing}
                onChange={(e) => set("stepCode", e.target.value)} placeholder="fumigation_cert" />
              {!editing && <p className="text-[11px] text-muted-foreground">Lowercase snake_case. Permanent once created.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-no">Canonical number</Label>
              <Input id="wf-no" type="number" min="1" value={form.canonicalNo}
                onChange={(e) => set("canonicalNo", e.target.value)} placeholder="e.g. 85" />
              <p className={`text-[11px] ${numberTaken ? "text-destructive" : "text-muted-foreground"}`}>
                {numberTaken ? "Already in use." : "Position in the path — space by 10s so later steps fit between."}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wf-title">Title</Label>
            <Input id="wf-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Fumigation Certificate Obtained" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wf-hint">Hint <span className="text-muted-foreground font-normal">(shown on the step panel)</span></Label>
            <Input id="wf-hint" value={form.hint} onChange={(e) => set("hint", e.target.value)}
              placeholder="One line on what completing this step actually means." />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Owning department</Label>
              <Select value={form.ownerDepartment} onValueChange={(v) => set("ownerDepartment", v)}
                items={meta.departments.map((d) => ({ value: d.code, label: d.name }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {meta.departments.map((d) => <SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Derives status</Label>
              <Select value={form.derivedStatus} onValueChange={(v) => set("derivedStatus", v)}
                items={meta.statuses.map((s) => ({ value: s, label: prettyCode(s) }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {meta.statuses.map((s) => <SelectItem key={s} value={s} className="capitalize">{prettyCode(s)}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Shipment status once this step completes.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-sla">Task SLA (hours)</Label>
              <Input id="wf-sla" type="number" min="1" value={form.dueOffsetHours} onChange={(e) => set("dueOffsetHours", e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Gates — empty means "don't restrict"
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Service packages</Label>
              <ChipToggle options={meta.packages} value={form.packages} onChange={(v) => set("packages", v)} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">CRO modes</Label>
                <ChipToggle options={meta.croModes} value={form.croModes} onChange={(v) => set("croModes", v)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">LC modes</Label>
                <ChipToggle options={meta.lcModes} value={form.lcModes} onChange={(v) => set("lcModes", v)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Services</Label>
              <ChipToggle options={meta.services} value={form.services} onChange={(v) => set("services", v)} />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={form.always} onCheckedChange={(v) => set("always", !!v)} />
              Always include (on the gated packages) — don't require a service match
            </label>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Required documents <span className="text-muted-foreground font-normal">(block completion until attached — RULE-SH-06)</span></Label>
            <ChipToggle
              options={activeDocTypes.map((t) => ({ code: t.code, label: t.label }))}
              value={form.requiredDocTypes}
              onChange={(v) => set("requiredDocTypes", v)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {editing ? "Save changes" : "Create step"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ══════════════════════════ Checklist (sub-actions) ══════════════════════════ */

const ChecklistDialog = ({ busy, meta, step, onClose, onSubmit }) => {
  const [rows, setRows] = useState(
    (step.actions ?? []).map((a) => ({
      actionCode: a.actionCode,
      title: a.title,
      kind: a.kind,
      docType: a.docType ?? "",
      sortOrder: String(a.sortOrder),
      required: a.required,
      packages: a.packages ?? [],
      croModes: a.croModes ?? [],
      lcModes: a.lcModes ?? [],
      services: a.services ?? [],
    })),
  );
  const setRow = (i, k, v) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () =>
    setRows((p) => [
      ...p,
      { actionCode: "", title: "", kind: "manual", docType: "", sortOrder: String((p.length + 1) * 10), required: true, packages: [], croModes: [], lcModes: [], services: [] },
    ]);
  const removeRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  const activeDocTypes = meta.docTypes.filter((t) => t.active);

  const submit = (e) => {
    e.preventDefault();
    for (const r of rows) {
      if (!/^[a-z][a-z0-9_]{1,49}$/.test(r.actionCode)) return toast.error(`"${r.actionCode || "(empty)"}" is not a valid item code`);
      if (!r.title.trim()) return toast.error("Every item needs a title");
      if (r.kind === "document" && !r.docType) return toast.error(`"${r.title}" is a document item — pick its document type`);
    }
    const codes = rows.map((r) => r.actionCode);
    if (new Set(codes).size !== codes.length) return toast.error("Item codes must be unique within the step");
    onSubmit(
      rows.map((r) => ({
        actionCode: r.actionCode,
        title: r.title.trim(),
        kind: r.kind,
        docType: r.kind === "document" ? r.docType : undefined,
        sortOrder: Number(r.sortOrder) || 0,
        required: r.required,
        packages: r.packages,
        croModes: r.croModes,
        lcModes: r.lcModes,
        services: r.services,
      })),
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Checklist — {step.title}</DialogTitle>
          <DialogDescription>
            The working items under this step. Document items are satisfied by attaching their file;
            manual items are ticked by the owning department. Gates work like the step's own —
            an item with a package chip only appears on that package.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3 py-2">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-6 text-center">
              No checklist — the step completes on its required documents alone.
            </p>
          )}
          {rows.map((r, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-2.5">
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3 space-y-1">
                  <Label className="text-[11px]">Item code</Label>
                  <Input value={r.actionCode} onChange={(e) => setRow(i, "actionCode", e.target.value)} placeholder="fumigation_cert" className="h-8 text-xs font-mono" />
                </div>
                <div className="col-span-4 space-y-1">
                  <Label className="text-[11px]">Title</Label>
                  <Input value={r.title} onChange={(e) => setRow(i, "title", e.target.value)} placeholder="Fumigation certificate attached" className="h-8 text-xs" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-[11px]">Kind</Label>
                  <Select value={r.kind} onValueChange={(v) => setRow(i, "kind", v)}
                    items={meta.actionKinds.map((k) => ({ value: k, label: k }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {meta.actionKinds.map((k) => <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-[11px]">Order</Label>
                  <Input type="number" min="0" value={r.sortOrder} onChange={(e) => setRow(i, "sortOrder", e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button type="button" size="sm" variant="ghost" className="h-8 text-destructive" onClick={() => removeRow(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {r.kind === "document" && (
                <div className="space-y-1">
                  <Label className="text-[11px]">Document type</Label>
                  <Select value={r.docType} onValueChange={(v) => setRow(i, "docType", v)}
                    items={activeDocTypes.map((t) => ({ value: t.code, label: t.label }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick the document…" /></SelectTrigger>
                    <SelectContent>
                      {activeDocTypes.map((t) => <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox checked={r.required} onCheckedChange={(v) => setRow(i, "required", !!v)} />
                  Required (blocks step completion)
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Packages:</span>
                  <ChipToggle options={meta.packages} value={r.packages} onChange={(v) => setRow(i, "packages", v)} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">LC:</span>
                  <ChipToggle options={meta.lcModes} value={r.lcModes} onChange={(v) => setRow(i, "lcModes", v)} />
                </div>
              </div>
            </div>
          ))}

          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={addRow}>
            <Plus className="w-3.5 h-3.5" /> Add item
          </Button>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />} Save checklist
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ══════════════════════════ Validate ══════════════════════════ */

const ValidateDialog = ({ onClose }) => {
  const [report, setReport] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    workflowService
      .validateCatalog()
      .then((res) => { setReport(res.data); setMessage(res.message); })
      .catch((err) => toast.error(err?.message || "Validation failed"));
  }, []);

  const badCombos = report?.combos.filter((c) => c.issues.length) ?? [];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="lg" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Catalog health</DialogTitle>
          <DialogDescription>
            Every package × CRO × LC combination is composed against the live catalog and checked for
            paths that can never finish.
          </DialogDescription>
        </DialogHeader>

        {!report ? (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="space-y-4 py-2 text-sm">
            <p className={badCombos.length || report.danglingDocTypes.length ? "text-amber-600" : "text-green-600"}>{message}</p>

            {badCombos.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Broken combinations</p>
                {badCombos.map((c, i) => (
                  <div key={i} className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-2 text-xs">
                    <b>{prettyCode(c.servicePackage)}</b> · CRO {c.croHandledBy} · LC {c.lcHandledBy}
                    {c.withDownstream ? " · +downstream" : ""} — {c.issues.join("; ")}
                  </div>
                ))}
              </div>
            )}

            {report.danglingDocTypes.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Unknown document types referenced</p>
                {report.danglingDocTypes.map((d, i) => (
                  <p key={i} className="text-xs text-amber-700 dark:text-amber-300">
                    <span className="font-mono">{d.stepCode}</span> requires <span className="font-mono">{d.docType}</span> ({d.source})
                  </p>
                ))}
              </div>
            )}

            {report.neverComposed.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Active steps no combination composes</p>
                <p className="text-xs text-muted-foreground">
                  {report.neverComposed.join(", ")} — check their gates (this may be intentional for add-on services).
                </p>
              </div>
            )}

            {!badCombos.length && !report.danglingDocTypes.length && !report.neverComposed.length && (
              <p className="text-muted-foreground text-xs">All {report.combos.length} combinations compose a complete, finishable path.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ══════════════════════════ Document types ══════════════════════════ */

const DocTypesTab = ({ onChanged }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", label: "", customerUploadable: false, sortOrder: "" });

  const load = async () => {
    setLoading(true);
    try {
      const res = await workflowService.listDocTypes();
      setRows(res.data || []);
    } catch (err) {
      toast.error(err?.message || "Could not load document types");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(okMsg || res?.message || "Saved");
      await load();
      onChanged?.();
      // The docType vocabulary is consumed by every upload picker and every docType label
      // in the app. Without this, adding or renaming one changed nothing anywhere else —
      // not even in this admin's own session — until the tab was reloaded.
      invalidate(TOPICS.WORKFLOW);
      return true;
    } catch (err) {
      toast.error(err?.message || "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(form.code)) return toast.error("Code must be lowercase snake_case, e.g. fumigation_cert");
    if (!form.label.trim()) return toast.error("A label is required");
    const ok = await act(() =>
      workflowService.createDocType({
        code: form.code,
        label: form.label.trim(),
        customerUploadable: form.customerUploadable,
        sortOrder: form.sortOrder === "" ? undefined : Number(form.sortOrder),
      }),
    );
    if (ok) {
      setOpen(false);
      setForm({ code: "", label: "", customerUploadable: false, sortOrder: "" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          The vocabulary every upload is tagged with — step gates match on these codes.
        </p>
        <Button className="gap-2" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> New document type</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Label</th>
                <th className="px-4 py-2.5">Customer can upload</th>
                <th className="px-4 py-2.5">In use</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((t) => {
                const used = (t.usage?.documents ?? 0) > 0 || (t.usage?.templates ?? 0) > 0;
                return (
                  <tr key={t.code} className={`hover:bg-muted/30 ${!t.active ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 font-mono text-xs">{t.code}</td>
                    <td className="px-4 py-2.5">
                      {t.label}
                      {!t.active && <Badge variant="outline" className="text-[10px] ml-2">inactive</Badge>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Checkbox
                        checked={t.customerUploadable}
                        disabled={busy}
                        onCheckedChange={(v) => act(() => workflowService.updateDocType(t.code, { customerUploadable: !!v }))}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {used
                        ? [t.usage.documents ? `${t.usage.documents} file(s)` : null, t.usage.templates ? `${t.usage.templates} template(s)` : null].filter(Boolean).join(", ")
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy}
                          onClick={() => act(() => workflowService.updateDocType(t.code, { active: !t.active }))}>
                          {t.active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-destructive" disabled={busy || used}
                          title={used ? "Referenced by files/templates — deactivate instead" : "Delete"}
                          onClick={() => act(() => workflowService.deleteDocType(t.code), `"${t.label}" deleted`)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New document type</DialogTitle>
            <DialogDescription>Becomes selectable on uploads and requirable on steps immediately.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dt-code">Code</Label>
                <Input id="dt-code" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} placeholder="fumigation_cert" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dt-sort">Sort order <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="dt-sort" type="number" min="0" value={form.sortOrder} onChange={(e) => setForm((p) => ({ ...p, sortOrder: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dt-label">Label</Label>
              <Input id="dt-label" value={form.label} onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))} placeholder="Fumigation Certificate" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={form.customerUploadable} onCheckedChange={(v) => setForm((p) => ({ ...p, customerUploadable: !!v }))} />
              Portal customers may upload this type
            </label>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy} className="gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* ══════════════════════════ Preview ══════════════════════════ */

const PreviewTab = ({ meta }) => {
  const [servicePackage, setServicePackage] = useState("international");
  const [croHandledBy, setCroHandledBy] = useState("consort");
  const [lcHandledBy, setLcHandledBy] = useState("not_applicable");
  const [withDownstream, setWithDownstream] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  const pkg = meta?.packages.find((p) => p.code === servicePackage);
  // The compose endpoint coerces invalid modes anyway; the UI mirrors allowedness.
  const croOptions = servicePackage === "local_transport" || servicePackage === "port_to_consignee"
    ? [{ code: "not_applicable", label: "Not applicable" }]
    : (meta?.croModes ?? []).filter((m) => m.code !== "not_applicable");
  const lcOptions = servicePackage === "loading_point_to_port" || servicePackage === "international"
    ? meta?.lcModes ?? []
    : [{ code: "not_applicable", label: "No LC" }];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    serviceCatalogService
      .composeServices({
        servicePackage,
        croHandledBy,
        lcHandledBy,
        services: withDownstream && servicePackage === "international" ? ["destination_services"] : undefined,
      })
      .then((res) => { if (alive) setPreview(res.data ?? null); })
      .catch(() => { if (alive) setPreview(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [servicePackage, croHandledBy, lcHandledBy, withDownstream]);

  if (!meta) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label>Service package</Label>
          <Select value={servicePackage} onValueChange={(v) => { setServicePackage(v); setCroHandledBy(v === "local_transport" || v === "port_to_consignee" ? "not_applicable" : "consort"); setLcHandledBy("not_applicable"); setWithDownstream(false); }}
            items={meta.packages.map((p) => ({ value: p.code, label: p.label }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {meta.packages.map((p) => <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>CRO</Label>
          <Select value={croHandledBy} onValueChange={setCroHandledBy}
            items={croOptions.map((m) => ({ value: m.code, label: m.label }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {croOptions.map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Letter of Credit</Label>
          <Select value={lcHandledBy} onValueChange={setLcHandledBy}
            items={lcOptions.map((m) => ({ value: m.code, label: m.label }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {lcOptions.map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>&nbsp;</Label>
          <label className={`flex items-center gap-2 text-sm h-9 ${servicePackage === "international" ? "cursor-pointer" : "opacity-40"}`}>
            <Checkbox checked={withDownstream} disabled={servicePackage !== "international"} onCheckedChange={(v) => setWithDownstream(!!v)} />
            Add downstream
          </label>
        </div>
      </div>

      {pkg && <p className="text-xs text-muted-foreground">{pkg.description}</p>}

      {loading ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : preview ? (
        <div className="rounded-xl border p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Eye className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium">This selection composes {preview.stepCount} steps</p>
            <span className="text-xs text-muted-foreground">· departments: {(preview.departments ?? []).join(", ")}</span>
          </div>
          <ol className="space-y-2">
            {preview.steps.map((s) => (
              <li key={s.stepCode} className="text-sm flex items-start gap-2.5">
                <span className="text-xs font-mono text-muted-foreground w-9 shrink-0 mt-0.5">{s.displayNo}.</span>
                <div className="min-w-0">
                  <p className="font-medium">{s.title} <span className="text-[11px] text-muted-foreground capitalize font-normal">— {s.ownerDepartment}</span></p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {(s.requiredDocTypes ?? []).map((d) => (
                      <Badge key={d} variant="secondary" className="text-[10px]">{prettyCode(d)}</Badge>
                    ))}
                    {(s.actions ?? []).filter((a) => a.kind === "manual").map((a) => (
                      <Badge key={a.actionCode} variant="outline" className="text-[10px]">☐ {a.title}</Badge>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Could not compose a preview for this selection.</p>
      )}
    </div>
  );
};
