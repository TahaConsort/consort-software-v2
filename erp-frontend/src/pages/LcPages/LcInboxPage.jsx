import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Landmark, Loader2, ArrowRight, Ban, Eye, Check } from "lucide-react";
import toast from "react-hot-toast";
import { useTopicRefresh } from "@/lib/useTopicRefresh";
import { invalidate } from "@/lib/invalidationBus";
import { TOPICS } from "@/lib/topics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/store/authStore";
import { listReferrals, setReferralStatus, rejectReferral, convertReferral } from "@/services/lcService";
import { DEFAULT_CURRENCY } from "@/lib/catalog";

const STATUS_STYLE = {
  received: "border-blue-400 text-blue-700 dark:text-blue-300",
  reviewing: "border-amber-400 text-amber-700 dark:text-amber-300",
  converted: "border-green-400 text-green-700 dark:text-green-300",
  rejected: "border-red-400 text-red-600",
};

const money = (n, ccy = DEFAULT_CURRENCY) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: ccy || DEFAULT_CURRENCY, maximumFractionDigits: 0 }).format(Number(n));

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");

/**
 * Bank LC inbox (CRM_MASTER §5.21) — the Operations inbox for the *bank_lc*
 * channel. Review an inbound LC and convert it to a customer + query.
 */
export default function LcInboxPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canConvert = hasPermission("lc.convert");

  const [referrals, setReferrals] = useState(null);
  const [filter, setFilter] = useState("received");
  // Which filter the rows in state belong to. Adjusted during render (React's documented
  // adjust-state-on-prop-change pattern) so switching filters blanks the previous result
  // set immediately, without a setState inside an effect.
  const [loadedFilter, setLoadedFilter] = useState(filter);
  if (loadedFilter !== filter) {
    setLoadedFilter(filter);
    setReferrals(null);
  }
  // Derived, so a BACKGROUND refresh never replaces the list with a spinner.
  const loading = referrals === null;
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [convertTarget, setConvertTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  // `isCurrent` is the stale guard: switching the filter quickly could otherwise leave
  // the losing response on screen, which reads as a stuck list.
  const load = useCallback(async ({ isCurrent } = {}) => {
    const ok = isCurrent ?? (() => true);
    try {
      const res = await listReferrals(filter === "all" ? undefined : filter);
      if (ok()) setReferrals(res.data || []);
    } catch (err) {
      if (ok()) toast.error(err?.message || "Could not load LC referrals");
    }
  }, [filter]);

  // This inbox exists to show work that arrives from OUTSIDE the app, so it is the last
  // screen that should need a manual reload — yet it had no live path at all.
  const { run: reload } = useTopicRefresh([TOPICS.LC_REFERRALS, TOPICS.QUERIES, TOPICS.CUSTOMERS], load);

  useEffect(() => { reload(); }, [filter, reload]);

  const act = async (fn, msg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      await reload();
      // Converting a referral mints a customer and a query, so those screens must re-read.
      // This page's own topic is deliberately absent: reload() above already covers it,
      // and publishing it would schedule a second, redundant request.
      invalidate(TOPICS.QUERIES, TOPICS.CUSTOMERS, TOPICS.LEADS, TOPICS.DASHBOARD);
      return res;
    } catch (err) {
      toast.error(err?.message || "Couldn't update the referral");
    } finally {
      setBusy(false);
    }
  };

  const doConvert = async () => {
    const res = await act(() => convertReferral(convertTarget.id), "Referral converted to query");
    setConvertTarget(null);
    setDetail(null);
    if (res?.data?.queryId) navigate("/admin/queries");
  };

  const doReject = async () => {
    if (rejectReason.trim().length < 3) return toast.error("A reason is required");
    await act(() => rejectReferral(rejectTarget.id, rejectReason), "Referral rejected");
    setRejectTarget(null);
    setRejectReason("");
    setDetail(null);
  };

  const FILTERS = ["received", "reviewing", "converted", "all"];

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Landmark className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Bank LC Inbox</h1>
          <p className="text-sm text-muted-foreground">Letters of Credit posted by partner banks (§5.21)</p>
        </div>
      </div>

      <div className="flex gap-1.5">
        {FILTERS.map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} className="capitalize" onClick={() => setFilter(f)}>
            {f}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : referrals.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">No LC referrals here.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Ref</th>
                <th className="px-4 py-2.5">LC No.</th>
                <th className="px-4 py-2.5">Applicant</th>
                <th className="px-4 py-2.5">Bank</th>
                <th className="px-4 py-2.5">Amount</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {referrals.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-mono text-xs">{r.referenceNo}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.lcNumber}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{r.applicantName || r.companyName || "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.originPort || "—"} → {r.destinationPort || "—"}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{r.bankName || "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{money(r.amount, r.currency)}</td>
                  <td className="px-4 py-2.5"><Badge variant="outline" className={`capitalize text-[10px] ${STATUS_STYLE[r.status] ?? ""}`}>{r.status}</Badge></td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => setDetail(r)}>
                        <Eye className="w-3.5 h-3.5" /> View
                      </Button>
                      {canConvert && !["converted", "rejected"].includes(r.status) && (
                        <Button size="sm" className="h-8 gap-1" disabled={busy} onClick={() => setConvertTarget(r)}>
                          <ArrowRight className="w-3.5 h-3.5" /> Convert
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.referenceNo} · LC {detail.lcNumber}</DialogTitle>
                <DialogDescription>{detail.bankName || "Bank"}{detail.bankRef ? ` · ${detail.bankRef}` : ""}</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5 text-sm">
                <p><span className="text-muted-foreground">Applicant:</span> {detail.applicantName || "—"}{detail.applicantEmail ? ` · ${detail.applicantEmail}` : ""}</p>
                {detail.beneficiaryName && <p><span className="text-muted-foreground">Beneficiary:</span> {detail.beneficiaryName}</p>}
                <p><span className="text-muted-foreground">Lane:</span> {detail.originPort || "—"} → {detail.destinationPort || "—"}</p>
                {detail.commodity && <p><span className="text-muted-foreground">Commodity:</span> {detail.commodity}</p>}
                <p><span className="text-muted-foreground">Amount:</span> {money(detail.amount, detail.currency)}{detail.incoterm ? ` · ${detail.incoterm}` : ""}</p>
                <p><span className="text-muted-foreground">Issue / Expiry:</span> {fmtDate(detail.issueDate)} → {fmtDate(detail.expiryDate)}</p>
                {detail.rejectReason && <p className="text-destructive">Rejected: {detail.rejectReason}</p>}
              </div>
              <DialogFooter className="flex-wrap gap-2">
                {!["converted", "rejected"].includes(detail.status) && (
                  <>
                    <Button variant="outline" size="sm" className="gap-1" disabled={busy}
                      onClick={() => act(() => setReferralStatus(detail.id, "reviewing"), "Marked reviewing").then(() => setDetail(null))}>
                      <Check className="w-3.5 h-3.5" /> Reviewing
                    </Button>
                    {canConvert && (
                      <Button variant="outline" size="sm" className="gap-1 text-destructive" disabled={busy}
                        onClick={() => { setRejectTarget(detail); setDetail(null); }}>
                        <Ban className="w-3.5 h-3.5" /> Reject
                      </Button>
                    )}
                    {canConvert && (
                      <Button size="sm" className="gap-1" disabled={busy} onClick={() => setConvertTarget(detail)}>
                        <ArrowRight className="w-3.5 h-3.5" /> Convert
                      </Button>
                    )}
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Convert confirm */}
      <Dialog open={!!convertTarget} onOpenChange={(o) => !o && setConvertTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert {convertTarget?.referenceNo}?</DialogTitle>
            <DialogDescription>
              This creates a customer (source: bank LC), a lead and a query (LC / Trade Finance is added automatically). You can then draft a quotation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTarget(null)}>Cancel</Button>
            <Button className="gap-2" disabled={busy} onClick={doConvert}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Convert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejectTarget?.referenceNo}?</DialogTitle>
            <DialogDescription>Give a reason — it is retained on the referral for audit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="lc-reject">Reason</Label>
            <Input id="lc-reject" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. LC terms outside our scope" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" className="gap-2" disabled={busy} onClick={doReject}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />} Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
