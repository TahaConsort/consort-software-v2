import { useEffect, useState } from "react";
import {
  CalendarClock,
  RefreshCw,
  AlertCircle,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  UserX,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import toast from "react-hot-toast";
import { useVisitStore } from "@/store/visitStore";
import { useReferenceStore } from "@/store/referenceStore";
import { useCustomerStore } from "@/store/customerStore";
import { useAuthStore } from "@/store/authStore";
import { VISIT_STATUS_LABELS } from "@/lib/catalog";
import { OUTREACH_OUTCOME_LABELS } from "../LeadsPages/LeadComponents/leadBadges";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");

const STATUS_STYLES = {
  planned: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-300",
  completed: "bg-green-50 text-green-700 border-green-400 dark:bg-green-950/30 dark:text-green-300",
  cancelled: "bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300",
  no_show: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300",
};

/**
 * VisitsListPage — scheduled field visits (ADR-043, WORKFLOW §2a).
 * Completing a visit records an outreach touch and can advance the lead
 * machine (RULE-VP-02); a no-show escalates BDO → ASM (RULE-VP-04).
 */
const VisitsListPage = () => {
  const {
    visits, loading, error, busy, filters, setFilter, fetchVisits,
    createVisit, completeVisit, noShowVisit, cancelVisit, rescheduleVisit,
  } = useVisitStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [dialog, setDialog] = useState(null); // { kind, visit } | 'add' | null

  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  // The store owns the refetch and the cross-list invalidation: completing or missing a
  // visit writes an outreach touch and can advance the lead (RULE-VP-02), so the Outreach
  // and Leads screens have to hear about it too.
  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      setDialog(null);
    } catch (err) {
      toast.error(err?.message || "Couldn't update the visit");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><CalendarClock className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Visit Plans</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Scheduled field visits to win and retain clients
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={filters.status || "all"} onValueChange={(v) => setFilter("status", v === "all" ? "" : v)} items={[{ value: "all", label: "All statuses" }, ...Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(VISIT_STATUS_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchVisits} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {hasPermission("visit.create") && (
            <Button size="sm" className="gap-2" onClick={() => setDialog({ kind: "add" })}>
              <Plus className="w-4 h-4" /> Plan Visit
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium flex-1">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchVisits} className="border-destructive/50 text-destructive hover:bg-destructive/10">Retry</Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-xl overflow-x-auto bg-white dark:bg-zinc-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left border-b">
            <tr>
              <th className="p-3 font-semibold text-muted-foreground">When</th>
              <th className="p-3 font-semibold text-muted-foreground">Target</th>
              <th className="p-3 font-semibold text-muted-foreground hidden md:table-cell">Purpose</th>
              <th className="p-3 font-semibold text-muted-foreground hidden sm:table-cell">Location</th>
              <th className="p-3 font-semibold text-muted-foreground hidden lg:table-cell">Assigned</th>
              <th className="p-3 font-semibold text-muted-foreground">Status</th>
              <th className="p-3 font-semibold text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && [...Array(3)].map((_, i) => (
              <tr key={i} className="border-t animate-pulse">
                {[...Array(7)].map((_, j) => <td key={j} className="p-3"><div className="h-4 bg-muted rounded w-3/4" /></td>)}
              </tr>
            ))}

            {!loading && visits.map((v) => (
              <tr key={v.id} className="border-t hover:bg-muted/30 transition-colors group">
                <td className="p-3 font-medium">{fmt(v.plannedAt)}</td>
                <td className="p-3">
                  <span className="font-medium">{v.targetCompany}</span>{" "}
                  <span className="text-xs text-muted-foreground">({v.targetRef})</span>
                </td>
                <td className="p-3 text-muted-foreground hidden md:table-cell">{v.purpose}</td>
                <td className="p-3 text-muted-foreground hidden sm:table-cell">{v.location}</td>
                <td className="p-3 text-muted-foreground hidden lg:table-cell">{v.assignedToName}</td>
                <td className="p-3">
                  <Badge variant="outline" className={`text-xs ${STATUS_STYLES[v.status] ?? ""}`}>
                    {VISIT_STATUS_LABELS[v.status]}
                  </Badge>
                </td>
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                    {v.status === "planned" && (
                      <>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1 hover:bg-primary/10 hover:text-primary" onClick={() => setDialog({ kind: "complete", visit: v })}>
                          <CheckCircle2 className="w-3.5 h-3.5" /> Complete
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1" onClick={() => act(() => noShowVisit(v.id), "Marked no-show")}>
                          <UserX className="w-3.5 h-3.5" /> No-show
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1 hover:bg-destructive/10 hover:text-destructive" onClick={() => setDialog({ kind: "cancel", visit: v })}>
                          <XCircle className="w-3.5 h-3.5" /> Cancel
                        </Button>
                      </>
                    )}
                    {["planned", "no_show"].includes(v.status) && (
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1" onClick={() => setDialog({ kind: "reschedule", visit: v })}>
                        <RotateCcw className="w-3.5 h-3.5" /> Reschedule
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {!loading && visits.length === 0 && !error && (
              <tr>
                <td colSpan="7" className="p-10 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <CalendarClock className="w-8 h-8 opacity-30" />
                    <p className="font-medium">No visits planned</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Dialogs */}
      {dialog?.kind === "add" && <AddVisitDialog busy={busy} onClose={() => setDialog(null)} onSubmit={(payload) => act(() => createVisit(payload), "Visit planned")} />}
      {dialog?.kind === "complete" && <CompleteDialog busy={busy} visit={dialog.visit} onClose={() => setDialog(null)} onSubmit={(payload) => act(() => completeVisit(dialog.visit.id, payload), "Visit completed")} />}
      {dialog?.kind === "cancel" && <CancelDialog busy={busy} onClose={() => setDialog(null)} onSubmit={(reason) => act(() => cancelVisit(dialog.visit.id, reason), "Visit cancelled")} />}
      {dialog?.kind === "reschedule" && <RescheduleDialog busy={busy} onClose={() => setDialog(null)} onSubmit={(plannedAt) => act(() => rescheduleVisit(dialog.visit.id, plannedAt), "Rescheduled")} />}
    </div>
  );
};

/* ── Plan a visit — target one of lead / customer (DATABASE §5 CHECK) ── */
const AddVisitDialog = ({ busy, onClose, onSubmit }) => {
  // referenceStore, NOT useLeadStore: that store applies the Leads PAGE's filters, so
  // whatever the user last filtered by there silently emptied this dropdown, and
  // reloading never helped because the filter was the cause.
  const { leads, fetch: fetchReference } = useReferenceStore();
  const { customers, fetchCustomers } = useCustomerStore();
  const [form, setForm] = useState({ targetType: "lead", targetId: "", purpose: "", plannedAt: "", location: "" });

  useEffect(() => { fetchReference("leads"); fetchCustomers(); }, [fetchReference, fetchCustomers]);

  const openLeads = leads.filter((l) => ["new", "contacted", "qualified"].includes(l.status));

  const submit = (e) => {
    e.preventDefault();
    if (!form.targetId) return toast.error("Pick a lead or customer");
    if (!form.plannedAt) return toast.error("Pick a date/time");
    onSubmit({
      ...(form.targetType === "lead" ? { leadId: form.targetId } : { customerId: form.targetId }),
      purpose: form.purpose,
      plannedAt: form.plannedAt,
      location: form.location,
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Plan a Visit</DialogTitle>
          <DialogDescription>A completed visit counts as an outreach touch on the target.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target Type</Label>
              <Select value={form.targetType} onValueChange={(v) => setForm((p) => ({ ...p, targetType: v, targetId: "" }))} items={[{ value: "lead", label: "Lead" }, { value: "customer", label: "Customer" }]}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="customer">Customer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{form.targetType === "lead" ? "Lead" : "Customer"}</Label>
              <Select value={form.targetId} onValueChange={(v) => setForm((p) => ({ ...p, targetId: v }))} items={(form.targetType === "lead" ? openLeads : customers).map((t) => ({ value: t.id, label: form.targetType === "lead" ? `${t.referenceNo} — ${t.company?.name ?? ""}` : `${t.referenceNo} — ${t.companyName}` }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {(form.targetType === "lead" ? openLeads : customers).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {form.targetType === "lead" ? `${t.referenceNo} — ${t.company?.name ?? ""}` : `${t.referenceNo} — ${t.companyName}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="visit-purpose">Purpose</Label>
            <Input id="visit-purpose" value={form.purpose} onChange={(e) => setForm((p) => ({ ...p, purpose: e.target.value }))} placeholder="e.g. Intro meeting, rate discussion" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="visit-when">Date & Time</Label>
              <Input id="visit-when" type="datetime-local" value={form.plannedAt} onChange={(e) => setForm((p) => ({ ...p, plannedAt: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="visit-location">Location</Label>
              <Input id="visit-location" value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} placeholder="City / office" required />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Plan Visit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ── Complete — outcome becomes the outreach touch (RULE-VP-02) ── */
const CompleteDialog = ({ busy, visit, onClose, onSubmit }) => {
  const [form, setForm] = useState({ outcome: "positive", notes: "", followUpAt: "" });
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Complete Visit</DialogTitle>
          <DialogDescription>{visit.purpose} — {visit.targetCompany}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ outcome: form.outcome, notes: form.notes || undefined, followUpAt: form.followUpAt || undefined });
          }}
          className="space-y-4 py-2"
        >
          <div className="space-y-1.5">
            <Label>Outcome</Label>
            <Select value={form.outcome} onValueChange={(v) => setForm((p) => ({ ...p, outcome: v }))}>
              <SelectTrigger><SelectValue>{OUTREACH_OUTCOME_LABELS[form.outcome]}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="positive">Positive</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
                <SelectItem value="negative">Negative</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="complete-notes">Notes</Label>
            <Input id="complete-notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="What happened?" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="complete-followup">Next follow-up (optional)</Label>
            <Input id="complete-followup" type="datetime-local" value={form.followUpAt} onChange={(e) => setForm((p) => ({ ...p, followUpAt: e.target.value }))} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Complete
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const CancelDialog = ({ busy, onClose, onSubmit }) => {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Cancel Visit</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 3) return toast.error("A reason is required"); onSubmit(reason.trim()); }} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy} className="bg-destructive text-white hover:bg-destructive/90">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cancel Visit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const RescheduleDialog = ({ busy, onClose, onSubmit }) => {
  const [when, setWhen] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Reschedule Visit</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (!when) return toast.error("Pick a new date/time"); onSubmit(when); }} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="resched-when">New Date & Time</Label>
            <Input id="resched-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reschedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default VisitsListPage;
