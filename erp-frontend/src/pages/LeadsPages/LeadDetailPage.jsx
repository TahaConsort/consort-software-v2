import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  User,
  Loader2,
  PhoneCall,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ArrowRightCircle,
  History,
} from "lucide-react";
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
import * as leadService from "@/services/leadService";
import {
  LeadStatusBadge,
  LeadSourceBadge,
  LEAD_STATUS_LABELS,
  OUTREACH_TYPE_LABELS,
  OUTREACH_OUTCOME_LABELS,
} from "./LeadComponents/leadBadges";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");

/**
 * LeadDetailPage — drives the lead machine (WORKFLOW §2):
 * outreach advances new→contacted; qualify needs a non-negative touch
 * (RULE-LD-02); lost needs a reason (RULE-LD-06); lost reopens (RULE-LD-04);
 * qualified converts in one transaction (RULE-LD-05).
 */
const LeadDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // 'outreach' | 'lost' | 'reopen' | 'convert' | null

  const fetchLead = useCallback(async () => {
    setLoading(true);
    try {
      const res = await leadService.getLead(id);
      setLead(res.data);
    } catch (err) {
      toast.error(err?.message || "Lead not found");
      navigate("/admin/leads");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { fetchLead(); }, [fetchLead]);

  const act = async (fn, successMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(successMsg || res?.message);
      setDialog(null);
      await fetchLead();
      return res;
    } catch (err) {
      toast.error(err?.message || "Couldn't update the lead");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !lead) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading lead…
      </div>
    );
  }

  const isOpen = ["new", "contacted", "qualified"].includes(lead.status);
  const hasPositiveTouch = lead.outreach?.some((o) => ["positive", "neutral"].includes(o.outcome));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/admin/leads" className="p-2 rounded-md border hover:bg-muted transition">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl leading-none font-semibold">{lead.referenceNo}</h1>
              <LeadStatusBadge status={lead.status} />
              <LeadSourceBadge source={lead.source} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">Owner: {lead.ownerName}</p>
          </div>
        </div>

        {/* Machine actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {isOpen && (
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setDialog("outreach")}>
              <PhoneCall className="w-4 h-4" /> Log Outreach
            </Button>
          )}
          {lead.status === "contacted" && (
            <Button
              size="sm"
              className="gap-2"
              title={hasPositiveTouch ? "" : "Needs at least one non-negative outreach (RULE-LD-02)"}
              disabled={!hasPositiveTouch || busy}
              onClick={() => act(() => leadService.transitionLead(lead.id, { toStatus: "qualified" }), "Lead qualified")}
            >
              <CheckCircle2 className="w-4 h-4" /> Qualify
            </Button>
          )}
          {lead.status === "qualified" && (
            <>
              <Button size="sm" className="gap-2" onClick={() => setDialog("convert")}>
                <ArrowRightCircle className="w-4 h-4" /> Convert to Customer
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act(() => leadService.transitionLead(lead.id, { toStatus: "contacted", notes: "De-qualified — needs more work" }), "Moved back to contacted")}
              >
                De-qualify
              </Button>
            </>
          )}
          {isOpen && (
            <Button size="sm" variant="outline" className="gap-2 border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => setDialog("lost")}>
              <XCircle className="w-4 h-4" /> Mark Lost
            </Button>
          )}
          {lead.status === "lost" && (
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setDialog("reopen")}>
              <RotateCcw className="w-4 h-4" /> Reopen
            </Button>
          )}
          {lead.status === "converted" && lead.convertedToCustomerId && (
            <Link to="/admin/customers">
              <Button size="sm" className="gap-2"><ArrowRightCircle className="w-4 h-4" /> View Customers</Button>
            </Link>
          )}
        </div>
      </div>

      {lead.status === "lost" && lead.lostReason && (
        <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive text-sm">
          <b>Lost reason:</b> {lead.lostReason}
        </div>
      )}

      {/* Company + Contact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border bg-white dark:bg-zinc-900 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="w-4 h-4 text-primary" /> Company
          </div>
          <p className="font-medium">{lead.company?.name ?? "—"}</p>
          <p className="text-sm text-muted-foreground">
            {[lead.company?.city, lead.company?.country].filter(Boolean).join(", ") || "No location"}
          </p>
        </div>

        <div className="p-4 rounded-xl border bg-white dark:bg-zinc-900 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <User className="w-4 h-4 text-primary" /> Contact
          </div>
          <p className="font-medium">
            {lead.contact?.name ?? "—"}
            {lead.contact?.position ? <span className="text-muted-foreground font-normal"> · {lead.contact.position}</span> : null}
          </p>
          <p className="text-sm text-muted-foreground">
            {[lead.contact?.email, lead.contact?.phone].filter(Boolean).join(" · ") || "No contact details"}
          </p>
        </div>
      </div>

      {/* Outreach + History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Outreach log */}
        <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm">
          <div className="px-4 py-3 border-b flex items-center gap-2 text-sm font-semibold">
            <PhoneCall className="w-4 h-4 text-primary" /> Outreach ({lead.outreach?.length ?? 0})
          </div>
          <div className="divide-y max-h-80 overflow-y-auto">
            {(lead.outreach ?? []).map((o) => (
              <div key={o.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {OUTREACH_TYPE_LABELS[o.type]} · {OUTREACH_OUTCOME_LABELS[o.outcome]}
                  </span>
                  <span className="text-xs text-muted-foreground">{fmt(o.occurredAt)}</span>
                </div>
                {o.notes && <p className="text-muted-foreground mt-1">{o.notes}</p>}
                {o.followUpAt && <p className="text-xs text-primary mt-1">Follow-up: {fmt(o.followUpAt)}</p>}
              </div>
            ))}
            {(lead.outreach ?? []).length === 0 && (
              <p className="px-4 py-8 text-sm text-muted-foreground text-center">
                No outreach yet — the first logged touch moves this lead to Contacted.
              </p>
            )}
          </div>
        </div>

        {/* Status history */}
        <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm">
          <div className="px-4 py-3 border-b flex items-center gap-2 text-sm font-semibold">
            <History className="w-4 h-4 text-primary" /> Status History
          </div>
          <div className="divide-y max-h-80 overflow-y-auto">
            {(lead.statusHistory ?? []).slice().reverse().map((h) => (
              <div key={h.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {h.fromStatus ? `${LEAD_STATUS_LABELS[h.fromStatus]} → ` : ""}
                    {LEAD_STATUS_LABELS[h.toStatus]}
                  </span>
                  <span className="text-xs text-muted-foreground">{fmt(h.createdAt)}</span>
                </div>
                {h.notes && <p className="text-muted-foreground mt-1">{h.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Dialogs ── */}
      <OutreachDialog
        open={dialog === "outreach"}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={(payload) => act(() => leadService.logOutreach(lead.id, payload), "Outreach logged")}
      />
      <ReasonDialog
        open={dialog === "lost"}
        busy={busy}
        title="Mark Lead Lost"
        description="A loss reason is mandatory — the conversion report is built on these (RULE-LD-06)."
        confirmLabel="Mark Lost"
        destructive
        onClose={() => setDialog(null)}
        onSubmit={(reason) => act(() => leadService.transitionLead(lead.id, { toStatus: "lost", reason }), "Lead marked lost")}
      />
      <ReasonDialog
        open={dialog === "reopen"}
        busy={busy}
        title="Reopen Lead"
        description="Reopening moves the lead back to Contacted (RULE-LD-04)."
        confirmLabel="Reopen"
        onClose={() => setDialog(null)}
        onSubmit={(reason) => act(() => leadService.reopenLead(lead.id, reason), "Lead reopened")}
      />
      <ConvertDialog
        open={dialog === "convert"}
        busy={busy}
        companyName={lead.company?.name}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          const res = await act(() => leadService.convertLead(lead.id), "Lead converted to customer");
          if (res) navigate("/admin/customers");
        }}
      />
    </div>
  );
};

/* ── Log Outreach dialog ── */
const OutreachDialog = ({ open, busy, onClose, onSubmit }) => {
  const [form, setForm] = useState({ type: "call", outcome: "neutral", notes: "", followUpAt: "" });

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      type: form.type,
      outcome: form.outcome,
      notes: form.notes || undefined,
      followUpAt: form.followUpAt || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Outreach</DialogTitle>
          <DialogDescription>The first touch on a new lead moves it to Contacted.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 py-2">
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
          <div className="space-y-1.5">
            <Label htmlFor="outreach-notes">Notes</Label>
            <Input id="outreach-notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="outreach-followup">Follow-up (optional)</Label>
            <Input id="outreach-followup" type="datetime-local" value={form.followUpAt} onChange={(e) => setForm((p) => ({ ...p, followUpAt: e.target.value }))} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Log
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ── Generic reason dialog (lost / reopen) ── */
const ReasonDialog = ({ open, busy, title, description, confirmLabel, destructive, onClose, onSubmit }) => {
  const [reason, setReason] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (reason.trim().length < 3) return toast.error("A reason is required");
    onSubmit(reason.trim());
    setReason("");
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="reason-input">Reason</Label>
            <Input id="reason-input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} className={destructive ? "bg-destructive text-white hover:bg-destructive/90" : ""}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ── Convert confirm dialog ── */
const ConvertDialog = ({ open, busy, companyName, onClose, onConfirm }) => (
  <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Convert to Customer</DialogTitle>
        <DialogDescription>
          Creates a customer record (CST-…) for <b>{companyName}</b> in one transaction,
          linked to the company and contact created with this lead. The lead becomes read-only.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={onConfirm} disabled={busy} className="gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightCircle className="w-4 h-4" />}
          Convert
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default LeadDetailPage;
