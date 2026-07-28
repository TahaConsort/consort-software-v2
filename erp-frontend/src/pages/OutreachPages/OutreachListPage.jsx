import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PhoneCall,
  RefreshCw,
  AlertCircle,
  Plus,
  Loader2,
  CalendarClock,
  AlarmClock,
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
import { useOutreachStore } from "@/store/outreachStore";
import { useLeadStore } from "@/store/leadStore";
import { useCustomerStore } from "@/store/customerStore";
import * as outreachService from "@/services/outreachService";
import {
  OUTREACH_TYPE_LABELS,
  OUTREACH_OUTCOME_LABELS,
} from "../LeadsPages/LeadComponents/leadBadges";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");

const BUCKET_STYLES = {
  overdue: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
  today: "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  upcoming: "border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
};

const OUTCOME_STYLES = {
  positive: "border-green-500 text-green-600 bg-green-50 dark:bg-green-950/30",
  neutral: "",
  negative: "border-red-400 text-red-600 bg-red-50 dark:bg-red-950/30",
  no_response: "border-zinc-300 text-zinc-500",
};

/**
 * OutreachListPage (CRM_MASTER §5.5) — the touch log across leads AND
 * customers, plus the follow-ups-due board. Completed Visit Plans appear
 * here automatically (they write an outreach row — RULE-VP-02).
 */
const OutreachListPage = () => {
  const {
    outreach, followUps, followUpCounts, loading, error,
    targetFilter, setTargetFilter, fetchOutreach, fetchFollowUps,
  } = useOutreachStore();
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchOutreach(); fetchFollowUps(); }, [fetchOutreach, fetchFollowUps]);

  const refresh = () => { fetchOutreach(); fetchFollowUps(); };

  const submit = async (payload) => {
    setBusy(true);
    try {
      const res = await outreachService.createOutreach(payload);
      toast.success(res?.message || "Outreach logged");
      setAddOpen(false);
      refresh();
    } catch (err) {
      toast.error(err?.message || "Failed to log outreach");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><PhoneCall className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Outreach</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Touches on leads and customers · follow-ups due
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={targetFilter || "all"} onValueChange={(v) => setTargetFilter(v === "all" ? "" : v)} items={[{ value: "all", label: "All targets" }, { value: "lead", label: "Leads" }, { value: "customer", label: "Customers" }]}>
            <SelectTrigger className="w-32 h-9"><SelectValue placeholder="Target" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All targets</SelectItem>
              <SelectItem value="lead">Leads</SelectItem>
              <SelectItem value="customer">Customers</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" /> Log Outreach
          </Button>
        </div>
      </div>

      {/* Follow-ups-due board (§5.5) */}
      <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlarmClock className="w-4 h-4 text-primary" /> Follow-ups Due
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className={BUCKET_STYLES.overdue}>Overdue {followUpCounts.overdue}</Badge>
            <Badge variant="outline" className={BUCKET_STYLES.today}>Today {followUpCounts.today}</Badge>
            <Badge variant="outline" className={BUCKET_STYLES.upcoming}>Next 7d {followUpCounts.upcoming}</Badge>
          </div>
        </div>
        <div className="divide-y max-h-64 overflow-y-auto">
          {followUps.map((f) => (
            <div key={f.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <Badge variant="outline" className={`text-[10px] w-20 justify-center ${BUCKET_STYLES[f.bucket]}`}>
                {f.bucket === "overdue" ? "Overdue" : f.bucket === "today" ? "Today" : "Upcoming"}
              </Badge>
              <span className="flex-1 min-w-0 truncate">
                {f.targetType === "lead" ? (
                  <Link to={`/admin/leads/${f.targetId}`} className="font-medium text-primary hover:underline">
                    {f.targetCompany}
                  </Link>
                ) : (
                  <span className="font-medium">{f.targetCompany}</span>
                )}
                <span className="text-muted-foreground"> ({f.targetRef}) — {OUTREACH_TYPE_LABELS[f.type]}{f.notes ? ` · ${f.notes}` : ""}</span>
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1 flex-shrink-0">
                <CalendarClock className="w-3.5 h-3.5" /> {fmt(f.followUpAt)}
              </span>
            </div>
          ))}
          {followUps.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">
              No follow-ups due — log outreach with a follow-up date and it lands here.
            </p>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium flex-1">{error}</p>
          <Button variant="outline" size="sm" onClick={refresh} className="border-destructive/50 text-destructive hover:bg-destructive/10">Retry</Button>
        </div>
      )}

      {/* Touch log */}
      <div className="border rounded-xl overflow-x-auto bg-white dark:bg-zinc-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left border-b">
            <tr>
              <th className="p-3 font-semibold text-muted-foreground">When</th>
              <th className="p-3 font-semibold text-muted-foreground">Target</th>
              <th className="p-3 font-semibold text-muted-foreground">Type</th>
              <th className="p-3 font-semibold text-muted-foreground">Outcome</th>
              <th className="p-3 font-semibold text-muted-foreground hidden md:table-cell">Notes</th>
              <th className="p-3 font-semibold text-muted-foreground hidden lg:table-cell">By</th>
              <th className="p-3 font-semibold text-muted-foreground hidden sm:table-cell">Follow-up</th>
            </tr>
          </thead>
          <tbody>
            {loading && [...Array(4)].map((_, i) => (
              <tr key={i} className="border-t animate-pulse">
                {[...Array(7)].map((_, j) => <td key={j} className="p-3"><div className="h-4 bg-muted rounded w-3/4" /></td>)}
              </tr>
            ))}

            {!loading && outreach.map((o) => (
              <tr key={o.id} className="border-t hover:bg-muted/30 transition-colors">
                <td className="p-3 text-muted-foreground">{fmt(o.occurredAt)}</td>
                <td className="p-3">
                  {o.targetType === "lead" ? (
                    <Link to={`/admin/leads/${o.targetId}`} className="font-medium text-primary hover:underline">
                      {o.targetCompany}
                    </Link>
                  ) : (
                    <span className="font-medium">{o.targetCompany}</span>
                  )}{" "}
                  <span className="text-xs text-muted-foreground">({o.targetRef})</span>
                </td>
                <td className="p-3">{OUTREACH_TYPE_LABELS[o.type]}</td>
                <td className="p-3">
                  <Badge variant="outline" className={`text-xs ${OUTCOME_STYLES[o.outcome] ?? ""}`}>
                    {OUTREACH_OUTCOME_LABELS[o.outcome]}
                  </Badge>
                </td>
                <td className="p-3 text-muted-foreground hidden md:table-cell max-w-xs truncate">{o.notes ?? "—"}</td>
                <td className="p-3 text-muted-foreground hidden lg:table-cell">{o.actorName}</td>
                <td className="p-3 text-muted-foreground hidden sm:table-cell">{o.followUpAt ? fmt(o.followUpAt) : "—"}</td>
              </tr>
            ))}

            {!loading && outreach.length === 0 && !error && (
              <tr>
                <td colSpan="7" className="p-10 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <PhoneCall className="w-8 h-8 opacity-30" />
                    <p className="font-medium">No outreach logged yet</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {addOpen && <LogOutreachDialog busy={busy} onClose={() => setAddOpen(false)} onSubmit={submit} />}
    </div>
  );
};

/* ── Log outreach — target a lead (pipeline) or a customer (retention) ── */
const LogOutreachDialog = ({ busy, onClose, onSubmit }) => {
  const { leads, fetchLeads } = useLeadStore();
  const { customers, fetchCustomers } = useCustomerStore();
  const [form, setForm] = useState({
    targetType: "lead",
    targetId: "",
    type: "call",
    outcome: "neutral",
    notes: "",
    durationMin: "",
    followUpAt: "",
  });

  useEffect(() => { fetchLeads(); fetchCustomers(); }, [fetchLeads, fetchCustomers]);

  const openLeads = leads.filter((l) => ["new", "contacted", "qualified"].includes(l.status));
  const activeCustomers = customers.filter((c) => c.isActive);

  const submit = (e) => {
    e.preventDefault();
    if (!form.targetId) return toast.error("Pick a lead or customer");
    onSubmit({
      ...(form.targetType === "lead" ? { leadId: form.targetId } : { customerId: form.targetId }),
      type: form.type,
      outcome: form.outcome,
      notes: form.notes || undefined,
      durationMin: form.durationMin ? Number(form.durationMin) : undefined,
      followUpAt: form.followUpAt || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Log Outreach</DialogTitle>
          <DialogDescription>
            Records a touch that already happened. The first touch on a new lead
            moves it to Contacted; scheduled future visits belong in Visit Plans.
          </DialogDescription>
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
              <Select value={form.targetId} onValueChange={(v) => setForm((p) => ({ ...p, targetId: v }))} items={(form.targetType === "lead" ? openLeads : activeCustomers).map((t) => ({ value: t.id, label: form.targetType === "lead" ? `${t.referenceNo} — ${t.company?.name ?? ""}` : `${t.referenceNo} — ${t.companyName}` }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {(form.targetType === "lead" ? openLeads : activeCustomers).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {form.targetType === "lead"
                        ? `${t.referenceNo} — ${t.company?.name ?? ""}`
                        : `${t.referenceNo} — ${t.companyName}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue>{OUTREACH_TYPE_LABELS[form.type]}</SelectValue></SelectTrigger>
                <SelectContent>
                  {Object.entries(OUTREACH_TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Outcome</Label>
              <Select value={form.outcome} onValueChange={(v) => setForm((p) => ({ ...p, outcome: v }))}>
                <SelectTrigger><SelectValue>{OUTREACH_OUTCOME_LABELS[form.outcome]}</SelectValue></SelectTrigger>
                <SelectContent>
                  {Object.entries(OUTREACH_OUTCOME_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="or-duration">Duration (min)</Label>
              <Input id="or-duration" type="number" min="1" value={form.durationMin} onChange={(e) => setForm((p) => ({ ...p, durationMin: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="or-followup">Follow-up (optional)</Label>
              <Input id="or-followup" type="datetime-local" value={form.followUpAt} onChange={(e) => setForm((p) => ({ ...p, followUpAt: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="or-notes">Notes</Label>
            <Input id="or-notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="What happened?" />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Log
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default OutreachListPage;
