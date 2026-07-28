import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, RefreshCw, AlertCircle, Plus, Loader2, Send, Check, X, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { useQuotationStore } from "@/store/quotationStore";
import { useAuthStore } from "@/store/authStore";
import * as quotationService from "@/services/quotationService";
import * as queryService from "@/services/queryService";
import * as chargeService from "@/services/chargeService";
import * as vendorService from "@/services/vendorService";
import { QUOTATION_STATUS_LABELS, labelForService } from "@/lib/catalog";

const STATUS_STYLES = {
  draft: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300",
  sent: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300",
  approved: "bg-green-50 text-green-700 border-green-400 dark:bg-green-950/30 dark:text-green-300",
  rejected: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300",
  expired: "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/20 dark:text-red-300",
};

const money = (n, ccy) => `${ccy || "USD"} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const QuotationsListPage = () => {
  const { quotations, loading, error, statusFilter, setStatusFilter, fetchQuotations } = useQuotationStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();

  const [addOpen, setAddOpen] = useState(false);
  const [detailFor, setDetailFor] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchQuotations(); }, [fetchQuotations]);

  const act = async (fn, successMsg, after) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(successMsg || res?.message);
      setAddOpen(false); setRejectFor(null); setDetailFor(null);
      fetchQuotations();
      after?.(res);
    } catch (err) {
      toast.error(err?.message || "Couldn't update the quotation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><FileText className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Quotations</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Ops drafts & sends; approval births the shipment and its composed OTD path
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)} items={[{ value: "all", label: "All statuses" }, ...Object.entries(QUOTATION_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(QUOTATION_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchQuotations} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          {hasPermission("quotation.create") && (
            <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" /> New Quotation
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium flex-1">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchQuotations}>Retry</Button>
        </div>
      )}

      <div className="border rounded-xl overflow-x-auto bg-white dark:bg-zinc-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left border-b">
            <tr>
              <th className="p-3 font-semibold text-muted-foreground">Ref</th>
              <th className="p-3 font-semibold text-muted-foreground">Query / Customer</th>
              <th className="p-3 font-semibold text-muted-foreground">Total</th>
              <th className="p-3 font-semibold text-muted-foreground">Status</th>
              <th className="p-3 font-semibold text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && [...Array(3)].map((_, i) => (
              <tr key={i} className="border-t animate-pulse">
                {[...Array(5)].map((_, j) => <td key={j} className="p-3"><div className="h-4 bg-muted rounded w-3/4" /></td>)}
              </tr>
            ))}

            {!loading && quotations.map((q) => (
              <tr key={q.id} className="border-t hover:bg-muted/30 transition-colors group">
                <td className="p-3">
                  <button className="font-medium text-primary hover:underline" onClick={() => setDetailFor(q)}>
                    {q.referenceNo}
                  </button>
                  {q.version > 1 && <span className="ml-1 text-[10px] text-muted-foreground">v{q.version}</span>}
                </td>
                <td className="p-3">
                  <span className="font-medium">{q.customerCompany}</span>{" "}
                  <span className="text-xs text-muted-foreground">({q.queryRef})</span>
                </td>
                <td className="p-3 font-medium">{money(q.totalAmount, q.currency)}</td>
                <td className="p-3">
                  <Badge variant="outline" className={`text-xs ${STATUS_STYLES[q.status] ?? ""}`}>
                    {QUOTATION_STATUS_LABELS[q.status]}
                  </Badge>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  {q.status === "draft" && hasPermission("quotation.send") && (
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1" disabled={busy}
                      onClick={() => act(() => quotationService.sendQuotation(q.id), "Quotation sent")}>
                      <Send className="w-3.5 h-3.5" /> Send
                    </Button>
                  )}
                  {q.status === "sent" && hasPermission("quotation.approve") && (
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1 text-green-600 hover:bg-green-500/10" disabled={busy}
                      onClick={() => act(() => quotationService.approveQuotation(q.id, q.rowVersion), "Approved", (r) => r?.data?.shipmentId && navigate(`/admin/shipments/${r.data.shipmentId}`))}>
                      <Check className="w-3.5 h-3.5" /> Approve
                    </Button>
                  )}
                  {q.status === "sent" && hasPermission("quotation.reject") && (
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1 text-destructive hover:bg-destructive/10" disabled={busy}
                      onClick={() => setRejectFor(q)}>
                      <X className="w-3.5 h-3.5" /> Reject
                    </Button>
                  )}
                  {["rejected", "expired"].includes(q.status) && hasPermission("quotation.revise") && (
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1" disabled={busy}
                      onClick={() => act(() => quotationService.reviseQuotation(q.id), "Revision drafted")}>
                      <RotateCcw className="w-3.5 h-3.5" /> Revise
                    </Button>
                  )}
                </td>
              </tr>
            ))}

            {!loading && quotations.length === 0 && !error && (
              <tr><td colSpan="5" className="p-10 text-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <FileText className="w-8 h-8 opacity-30" /><p className="font-medium">No quotations yet</p>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {addOpen && (
        <CreateQuotationDialog busy={busy} onClose={() => setAddOpen(false)}
          onSubmit={(payload) => act(() => quotationService.createQuotation(payload), "Quotation drafted")} />
      )}
      {detailFor && <QuotationDetailDialog quotation={detailFor} onClose={() => setDetailFor(null)} />}
      {rejectFor && (
        <RejectDialog busy={busy} quotation={rejectFor} onClose={() => setRejectFor(null)}
          onSubmit={(reason) => act(() => quotationService.rejectQuotation(rejectFor.id, reason), "Quotation rejected")} />
      )}
    </div>
  );
};

/* ── Create — pick a quotable query, add charge lines (server computes totals) ── */
const CreateQuotationDialog = ({ busy, onClose, onSubmit }) => {
  const [queries, setQueries] = useState([]);
  const [queryId, setQueryId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [validityDate, setValidityDate] = useState("");
  const [lines, setLines] = useState([{ description: "", quantity: 1, unitPrice: "", chargeCode: "", cost: "", vendorId: "" }]);
  const [chargeTypes, setChargeTypes] = useState([]);
  const [vendors, setVendors] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        // Quotable queries: open / quoted / revision_requested.
        const res = await queryService.listQueries();
        setQueries((res.data ?? []).filter((q) => ["open", "quoted", "revision_requested"].includes(q.status)));
      } catch { /* ignore */ }
      chargeService.listChargeTypes().then((r) => setChargeTypes(r.data || [])).catch(() => {});
      vendorService.listVendors({ isActive: true }).then((r) => setVendors(r.data || [])).catch(() => {});
    })();
  }, []);

  const selectedQuery = queries.find((q) => q.id === queryId);
  const setLine = (i, key, val) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));
  const addLine = () => setLines((p) => [...p, { description: "", quantity: 1, unitPrice: "", chargeCode: "", cost: "", vendorId: "" }]);
  const removeLine = (i) => setLines((p) => p.filter((_, idx) => idx !== i));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const costTotal = lines.reduce((s, l) => s + (l.cost !== "" ? Number(l.cost) || 0 : 0), 0);
  const margin = total - costTotal;

  const submit = (e) => {
    e.preventDefault();
    if (!queryId) return toast.error("Pick a query");
    const clean = lines.filter((l) => l.description && l.unitPrice !== "");
    if (!clean.length) return toast.error("Add at least one charge line");
    onSubmit({
      queryId,
      currency,
      validityDate: validityDate || undefined,
      chargeLines: clean.map((l, i) => ({
        description: l.description,
        quantity: Number(l.quantity) || 1,
        unitPrice: Number(l.unitPrice),
        chargeCode: l.chargeCode || undefined,
        costAmount: l.cost !== "" ? Number(l.cost) : undefined,
        costVendorId: l.vendorId || undefined,
        sortOrder: i,
      })),
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Quotation</DialogTitle>
          <DialogDescription>Totals are computed server-side (RULE-QT-02). Only ops_manager can send.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 py-2">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Query</Label>
              <Select value={queryId} onValueChange={setQueryId} items={queries.map((q) => ({ value: q.id, label: `${q.referenceNo} — ${q.customerCompany}` }))}>
                <SelectTrigger><SelectValue placeholder="Select a query…" /></SelectTrigger>
                <SelectContent>
                  {queries.map((q) => (
                    <SelectItem key={q.id} value={q.id}>{q.referenceNo} — {q.customerCompany}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qt-ccy">Currency</Label>
              <Input id="qt-ccy" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
          </div>

          {selectedQuery && (
            <div className="flex flex-wrap gap-1">
              {selectedQuery.services.map((s) => <Badge key={s} variant="secondary" className="text-[10px]">{labelForService(s)}</Badge>)}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="qt-validity">Validity date (optional)</Label>
            <Input id="qt-validity" type="date" value={validityDate} onChange={(e) => setValidityDate(e.target.value)} />
          </div>

          {/* Charge lines — sell side + internal cost sheet (buy side) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Charge lines <span className="text-[11px] font-normal text-muted-foreground">(cost & vendor are internal only)</span></Label>
              <Button type="button" size="sm" variant="outline" className="gap-1 h-8" onClick={addLine}>
                <Plus className="w-3.5 h-3.5" /> Add line
              </Button>
            </div>
            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={i} className="border rounded-lg p-2 space-y-2">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <Input className="col-span-6" placeholder="Description" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} />
                    <Input className="col-span-2" type="number" min="0" step="0.01" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} />
                    <Input className="col-span-3" type="number" min="0" step="0.01" placeholder="Sell price" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} />
                    <button type="button" className="col-span-1 text-muted-foreground hover:text-destructive" onClick={() => removeLine(i)} disabled={lines.length === 1}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <Select value={l.chargeCode || "none"} onValueChange={(v) => setLine(i, "chargeCode", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Charge type" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— type —</SelectItem>
                          {chargeTypes.map((t) => <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input className="col-span-3 h-8 text-xs" type="number" min="0" step="0.01" placeholder="Cost (buy)" value={l.cost} onChange={(e) => setLine(i, "cost", e.target.value)} />
                    <div className="col-span-4">
                      <Select value={l.vendorId || "none"} onValueChange={(v) => setLine(i, "vendorId", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Vendor" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— vendor —</SelectItem>
                          {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-4 text-sm pt-1">
              <span className="text-muted-foreground">Cost {money(costTotal, currency)}</span>
              <span className="font-semibold">Sell {money(total, currency)}</span>
              <span className={`font-semibold ${margin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>Margin {money(margin, currency)}</span>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Draft Quotation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const QuotationDetailDialog = ({ quotation, onClose }) => {
  const [full, setFull] = useState(quotation);
  useEffect(() => {
    quotationService.getQuotation(quotation.id).then((r) => setFull(r.data)).catch(() => {});
  }, [quotation.id]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{full.referenceNo}{full.version > 1 ? ` · v${full.version}` : ""}</DialogTitle>
          <DialogDescription>{full.customerCompany} · {full.queryRef}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <div className="flex flex-wrap gap-1">
            {(full.services ?? []).map((s) => <Badge key={s} variant="secondary" className="text-[10px]">{labelForService(s)}</Badge>)}
          </div>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr><th className="p-2">Description</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit</th><th className="p-2 text-right">Amount</th></tr>
              </thead>
              <tbody>
                {(full.chargeLines ?? []).map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="p-2">{l.description}</td>
                    <td className="p-2 text-right">{Number(l.quantity)}</td>
                    <td className="p-2 text-right">{Number(l.unitPrice).toLocaleString()}</td>
                    <td className="p-2 text-right font-medium">{Number(l.amount).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-right font-semibold">Total: {money(full.totalAmount, full.currency)}</div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const RejectDialog = ({ busy, quotation, onClose, onSubmit }) => {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject {quotation.referenceNo}</DialogTitle>
          <DialogDescription>The query moves to "revision requested" so Ops can re-quote (ADR-030).</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 3) return toast.error("A reason is required"); onSubmit(reason.trim()); }} className="space-y-4 py-2">
          <div className="space-y-1.5"><Label htmlFor="qt-reject">Reason</Label>
            <Input id="qt-reject" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy} className="bg-destructive text-white hover:bg-destructive/90">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reject"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default QuotationsListPage;
