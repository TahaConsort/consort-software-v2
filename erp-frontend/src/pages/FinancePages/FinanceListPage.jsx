import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Receipt, Loader2, Ship, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilePlus } from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { useFinanceStore } from "@/store/financeStore";
import { INVOICE_STATUS_LABELS, CHARGE_STATUS_LABELS } from "@/lib/catalog";
import * as shipmentService from "@/services/shipmentService";
import * as chargeService from "@/services/chargeService";
import { createInvoiceFromCharges } from "@/services/financeService";

/**
 * Finance workspace (CRM_MASTER §5.11, §5.17). Accounts issues invoices, records
 * payments and voids while unpaid; issuing auto-completes OTC 1 and full payment
 * OTC 2 (RULE-FI-02/03). Management reads; a customer would only ever see their
 * own via the portal (this screen is internal).
 */
const money = (n, ccy) => `${ccy || "USD"} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
const paidOf = (inv) => (inv.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);

const FILTERS = ["", "draft", "issued", "part_paid", "paid", "void"];

const FinanceListPage = () => {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { invoices, loading, busy, error, statusFilter, setFilter, kindFilter, setKindFilter, fetchInvoices, issueInvoice, recordPayment, voidInvoice } =
    useFinanceStore();
  const [dialog, setDialog] = useState(null); // { kind, invoiceId }

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      setDialog(null);
    } catch (err) {
      toast.error(err?.message || "Couldn't update the invoice");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Receipt className="w-6 h-6 text-primary" /> Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">Issue, collect and reconcile — drives OTC milestones 1 & 2 (RULE-FI-02/03).</p>
        </div>
        <div className="w-44">
          <Select value={statusFilter || "all"} onValueChange={(v) => setFilter(v === "all" ? "" : v)} items={FILTERS.map((f) => ({ value: f || "all", label: f ? INVOICE_STATUS_LABELS[f] : "All statuses" }))}>
            <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => <SelectItem key={f || "all"} value={f || "all"}>{f ? INVOICE_STATUS_LABELS[f] : "All statuses"}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Receivable / Payable tabs + bill-charges entry point */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border p-0.5 bg-muted/40">
          {[
            { value: "receivable", label: "Receivables (owed to us)" },
            { value: "payable", label: "Payables (we owe)" },
          ].map((tab) => (
            <button key={tab.value} type="button"
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${kindFilter === tab.value ? "bg-white dark:bg-zinc-900 shadow-sm font-medium" : "text-muted-foreground"}`}
              onClick={() => setKindFilter(tab.value)}>
              {tab.label}
            </button>
          ))}
        </div>
        {hasPermission("invoice.create") && (
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setDialog({ kind: "billCharges" })}>
            <FilePlus className="w-4 h-4" /> Bill charges
          </Button>
        )}
      </div>

      {error && <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm">{error}</div>}
      {loading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>}

      {!loading && invoices.length === 0 && (
        <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-10 text-center text-muted-foreground text-sm">No invoices yet.</div>
      )}

      <div className="grid gap-3">
        {invoices.map((inv) => {
          const paid = paidOf(inv);
          const outstanding = Number(inv.totalAmount) - paid;
          return (
            <div key={inv.id} className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-primary">{inv.referenceNo}</span>
                    <Badge variant="outline" className="text-[10px]">{INVOICE_STATUS_LABELS[inv.status]}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {money(inv.totalAmount, inv.currency)}
                    {paid > 0 && inv.status !== "paid" && <span> · paid {money(paid, inv.currency)} · outstanding {money(outstanding, inv.currency)}</span>}
                  </p>
                  {(inv.kind ?? "receivable") === "payable" && (inv.vendor?.name || inv.counterparty) && (
                    <p className="text-xs text-muted-foreground mt-0.5">Vendor: {inv.vendor?.name ?? inv.counterparty}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {inv.status === "draft" && hasPermission("invoice.issue") && (
                    <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy}
                      onClick={() => act(() => issueInvoice(inv.id), (inv.kind ?? "receivable") === "payable" ? "Payable approved for payment" : "Invoice issued — OTC 1 complete")}>
                      {(inv.kind ?? "receivable") === "payable" ? "Approve" : "Issue"}
                    </Button>
                  )}
                  {["issued", "part_paid"].includes(inv.status) && hasPermission("payment.record") && (
                    <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy}
                      onClick={() => setDialog({ kind: "payment", invoiceId: inv.id })}>Record payment</Button>
                  )}
                  {["draft", "issued"].includes(inv.status) && hasPermission("invoice.void") && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" disabled={busy}
                      onClick={() => setDialog({ kind: "void", invoiceId: inv.id })}>Void</Button>
                  )}
                  {inv.shipmentId && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => navigate(`/admin/shipments/${inv.shipmentId}`)}>
                      <Ship className="w-3.5 h-3.5" /> Shipment <ExternalLink className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {dialog?.kind === "payment" && (
        <PaymentDialog busy={busy} onClose={() => setDialog(null)}
          onSubmit={(payload) => act(() => recordPayment(dialog.invoiceId, payload), "Payment recorded")} />
      )}
      {dialog?.kind === "void" && (
        <VoidDialog busy={busy} onClose={() => setDialog(null)}
          onSubmit={(reason) => act(() => voidInvoice(dialog.invoiceId, reason), "Invoice voided")} />
      )}
      {dialog?.kind === "billCharges" && (
        <BillChargesDialog defaultDirection={kindFilter || "payable"} onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); fetchInvoices(); }} />
      )}
    </div>
  );
};

/* ── Bill unbilled job-charges into a draft invoice. ── */
const BillChargesDialog = ({ defaultDirection, onClose, onDone }) => {
  const [shipments, setShipments] = useState([]);
  const [shipmentId, setShipmentId] = useState("");
  const [direction, setDirection] = useState(defaultDirection);
  const [charges, setCharges] = useState([]);
  const [selected, setSelected] = useState({});
  const [loadingCharges, setLoadingCharges] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    shipmentService.listShipments().then((r) => setShipments((r.data || []).filter((s) => !["closed", "cancelled"].includes(s.status)))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!shipmentId) { setCharges([]); return; }
    setLoadingCharges(true);
    chargeService.listCharges({ shipmentId, direction })
      .then((r) => setCharges((r.data || []).filter((c) => !c.invoiceLineId && ["estimated", "confirmed"].includes(c.status))))
      .catch(() => setCharges([]))
      .finally(() => setLoadingCharges(false));
    setSelected({});
  }, [shipmentId, direction]);

  const toggle = (id) => setSelected((p) => ({ ...p, [id]: !p[id] }));
  const chosen = charges.filter((c) => selected[c.id]);
  // For payables all chosen charges must share a vendor (server enforces too).
  const vendorIds = [...new Set(chosen.map((c) => c.vendorId).filter(Boolean))];

  const submit = async () => {
    if (!chosen.length) return toast.error("Select at least one charge");
    if (direction === "payable" && vendorIds.length !== 1) return toast.error("Select charges from a single vendor");
    setSubmitting(true);
    try {
      const res = await createInvoiceFromCharges({
        shipmentId, direction, chargeIds: chosen.map((c) => c.id),
        vendorId: direction === "payable" ? vendorIds[0] : undefined,
      });
      toast.success(res?.message || "Invoice drafted");
      onDone();
    } catch (err) {
      toast.error(err?.message || "Could not draft invoice");
    } finally {
      setSubmitting(false);
    }
  };

  const money = (n, ccy) => `${ccy || "USD"} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;

  return (
    <Dialog open onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>Bill charges</DialogTitle>
          <DialogDescription>Draft a {direction} invoice from a shipment's unbilled charges. Payables must share one vendor.</DialogDescription></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Direction</Label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="payable">Payable (we owe)</SelectItem>
                  <SelectItem value="receivable">Receivable (owed to us)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Shipment</Label>
              <Select value={shipmentId || "none"} onValueChange={(v) => setShipmentId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— select —</SelectItem>
                  {shipments.map((s) => <SelectItem key={s.id} value={s.id}>{s.referenceNo} · {s.customerCompany}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {shipmentId && (
            loadingCharges ? (
              <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : charges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unbilled {direction} charges on this shipment.</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {charges.map((c) => (
                  <label key={c.id} className="flex items-center justify-between gap-2 border rounded-lg p-2 text-sm cursor-pointer">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={!!selected[c.id]} onChange={() => toggle(c.id)} />
                      <span>{c.chargeType?.label ?? c.chargeCode}{direction === "payable" && c.vendor ? ` · ${c.vendor.name}` : ""}</span>
                      <Badge variant="outline" className="text-[9px]">{CHARGE_STATUS_LABELS[c.status] ?? c.status}</Badge>
                    </span>
                    <span className="text-muted-foreground">{money(c.actualAmount ?? c.estimatedAmount, c.currency)}</span>
                  </label>
                ))}
              </div>
            )
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={submitting || !chosen.length}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : `Draft invoice (${chosen.length})`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const PaymentDialog = ({ busy, onClose, onSubmit }) => {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [ref, setRef] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Full settlement auto-completes OTC milestone 2 (RULE-FI-03).</DialogDescription></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (!(Number(amount) > 0)) return toast.error("Enter an amount"); onSubmit({ amount: Number(amount), method, referenceNumber: ref || undefined }); }} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="pay-amt">Amount</Label>
              <Input id="pay-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
            <div className="space-y-1.5"><Label>Method</Label>
              <Select value={method} onValueChange={setMethod} items={["bank_transfer", "cheque", "cash", "lc_settlement", "other"].map((m) => ({ value: m, label: m.replace(/_/g, " ") }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["bank_transfer", "cheque", "cash", "lc_settlement", "other"].map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="pay-ref">Reference (optional)</Label>
            <Input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Record"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const VoidDialog = ({ busy, onClose, onSubmit }) => {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Void invoice</DialogTitle>
          <DialogDescription>An invoice is voidable only while unpaid (RULE-FI-05).</DialogDescription></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 3) return toast.error("A reason is required"); onSubmit(reason.trim()); }} className="space-y-4 py-2">
          <div className="space-y-1.5"><Label htmlFor="void-reason">Void reason</Label>
            <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy} className="bg-destructive text-white hover:bg-destructive/90">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Void"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default FinanceListPage;
