import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Receipt, Loader2, Ship, ExternalLink, Plus, Trash2, AlertTriangle,
  ChevronDown, ChevronUp, FilterX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { useFinanceStore } from "@/store/financeStore";
import {
  INVOICE_STATUS_LABELS, PAYMENT_STATE_FILTERS, PAYMENT_STATE_CLASS,
  paymentStateOf, overdueDaysOf, DEFAULT_CURRENCY,
} from "@/lib/catalog";
import { INVOICE_KIND_LABELS } from "@/services/financeService";
import { useReferenceStore } from "@/store/referenceStore";

/**
 * Finance workspace (CRM_MASTER §5.11, §5.17). Accounts raises invoices, issues
 * them, records payments and voids while unpaid; issuing auto-completes OTC 1 and
 * full payment OTC 2 (RULE-FI-02/03). Management reads; a customer would only ever
 * see their own via the portal (this screen is internal).
 *
 * Invoices are the single money record on a job, so this screen answers the two
 * questions Accounts actually has: what is still owed, and what is overdue.
 */
const money = (n, ccy) => `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
const compact = (n, ccy) => `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const paidOf = (inv) => (inv.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);

const FinanceListPage = () => {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const {
    invoices, allOfKind, loading, busy, error, filters, setFilter,
    setKindFilter, fetchInvoices, issueInvoice, recordPayment, voidInvoice, createInvoice,
  } = useFinanceStore();
  const [dialog, setDialog] = useState(null); // { kind, invoiceId }

  // Picker data from referenceStore, so a shipment or vendor created since this tab
  // opened is actually selectable. These were fetch-once-per-mount with no invalidation.
  const { shipments: allShipments, vendors, fetch: fetchReference } = useReferenceStore();

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  // Raising an invoice needs a shipment to hang it on and (for payables) a vendor.
  // Best-effort: the button still works if either list fails, it just offers less.
  useEffect(() => {
    if (!hasPermission("invoice.create")) return;
    fetchReference("shipments", "vendors");
  }, [hasPermission, fetchReference]);

  // A closed or cancelled order cannot take a new invoice.
  const shipments = allShipments.filter((sh) => !["closed", "cancelled"].includes(sh.status));

  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      setDialog(null);
    } catch (err) {
      toast.error(err?.message || "Couldn't update the invoice");
    }
  };

  // Totals describe the whole tab, not the filtered slice — otherwise picking
  // "Paid" would report zero outstanding and read like nothing is owed.
  const live = allOfKind.filter((i) => i.status !== "void");
  const totals = live.reduce(
    (t, i) => {
      const paid = paidOf(i);
      t.invoiced += Number(i.totalAmount ?? 0);
      t.collected += paid;
      t.outstanding += Math.max(0, Number(i.totalAmount ?? 0) - paid);
      if (overdueDaysOf(i) > 0) { t.overdue += Math.max(0, Number(i.totalAmount ?? 0) - paid); t.overdueCount += 1; }
      return t;
    },
    { invoiced: 0, collected: 0, outstanding: 0, overdue: 0, overdueCount: 0 },
  );
  const ccy = live[0]?.currency;
  const receivable = filters.kind === "receivable";
  const filterLabel = PAYMENT_STATE_FILTERS.find((f) => f.value === filters.paymentState)?.label;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Receipt className="w-6 h-6 text-primary" /> Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">Raise, issue, collect and reconcile — drives OTC milestones 1 &amp; 2 (RULE-FI-02/03).</p>
        </div>
        <div className="flex items-center gap-2">
          {hasPermission("invoice.create") && (
            <Button size="sm" className="gap-2" onClick={() => setDialog({ kind: "create" })}>
              <Plus className="w-4 h-4" /> New invoice
            </Button>
          )}
          <div className="w-40">
            <Select value={filters.paymentState || ""} onValueChange={(v) => setFilter("paymentState", v === "__all" ? "" : v)}
              items={PAYMENT_STATE_FILTERS.map((f) => ({ value: f.value || "__all", label: f.label }))}>
              <SelectTrigger><SelectValue placeholder="All invoices" /></SelectTrigger>
              <SelectContent>
                {PAYMENT_STATE_FILTERS.map((f) => <SelectItem key={f.value || "__all"} value={f.value || "__all"}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Receivable / Payable tabs */}
      <div className="inline-flex rounded-lg border p-0.5 bg-muted/40">
        {[
          { value: "receivable", label: "Receivables (owed to us)" },
          { value: "payable", label: "Payables (we owe)" },
        ].map((tab) => (
          <button key={tab.value} type="button"
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${filters.kind === tab.value ? "bg-white dark:bg-zinc-900 shadow-sm font-medium" : "text-muted-foreground"}`}
            onClick={() => setKindFilter(tab.value)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* What Accounts needs at a glance for this ledger */}
      {!loading && live.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryTile label="Invoiced" value={compact(totals.invoiced, ccy)} hint={`${live.length} live invoice${live.length > 1 ? "s" : ""}`} />
          <SummaryTile label={receivable ? "Collected" : "Paid out"} value={compact(totals.collected, ccy)} tone="emerald" />
          <SummaryTile label="Outstanding" value={compact(totals.outstanding, ccy)} tone={totals.outstanding > 0 ? "amber" : "muted"} />
          <SummaryTile label="Overdue" value={compact(totals.overdue, ccy)}
            hint={totals.overdueCount > 0 ? `${totals.overdueCount} past due` : "nothing past due"}
            tone={totals.overdueCount > 0 ? "red" : "muted"} />
        </div>
      )}

      {error && <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm">{error}</div>}
      {loading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>}

      {/* Two different empty states — "none exist" and "none match" need different exits. */}
      {!loading && invoices.length === 0 && (
        <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-10 text-center space-y-3">
          <p className="text-muted-foreground text-sm">
            {allOfKind.length === 0
              ? `No ${receivable ? "receivable" : "payable"} invoices yet.`
              : `No ${filterLabel?.toLowerCase()} invoices in this ledger.`}
          </p>
          {allOfKind.length > 0 && filters.paymentState && (
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setFilter("paymentState", "")}>
              <FilterX className="w-3.5 h-3.5" /> Clear filter
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-3">
        {invoices.map((inv) => (
          <InvoiceCard key={inv.id} inv={inv} busy={busy} hasPermission={hasPermission}
            onOpenShipment={() => navigate(`/admin/shipments/${inv.shipmentId}`)}
            onIssue={() => act(
              () => issueInvoice(inv.id),
              (inv.kind ?? "receivable") === "payable" ? "Payable approved for payment" : "Invoice issued — OTC 1 complete",
            )}
            onPay={() => setDialog({ kind: "payment", invoiceId: inv.id })}
            onVoid={() => setDialog({ kind: "void", invoiceId: inv.id })} />
        ))}
      </div>

      {dialog?.kind === "payment" && (
        <PaymentDialog busy={busy} invoice={invoices.find((i) => i.id === dialog.invoiceId)} onClose={() => setDialog(null)}
          onSubmit={(payload) => act(() => recordPayment(dialog.invoiceId, payload), "Payment recorded")} />
      )}
      {dialog?.kind === "void" && (
        <VoidDialog busy={busy} onClose={() => setDialog(null)}
          onSubmit={(reason) => act(() => voidInvoice(dialog.invoiceId, reason), "Invoice voided")} />
      )}
      {dialog?.kind === "create" && (
        <CreateInvoiceDialog busy={busy} shipments={shipments} vendors={vendors} defaultKind={filters.kind}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => act(() => createInvoice(payload), "Invoice drafted")} />
      )}
    </div>
  );
};

const TONE = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  muted: "text-muted-foreground",
};

const SummaryTile = ({ label, value, hint, tone }) => (
  <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-3">
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className={`text-lg font-semibold mt-0.5 ${TONE[tone] ?? ""}`}>{value}</p>
    {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
  </div>
);

/* ── One invoice: paid/unpaid at a glance, full detail on expand. ── */
const InvoiceCard = ({ inv, busy, hasPermission, onOpenShipment, onIssue, onPay, onVoid }) => {
  const [open, setOpen] = useState(false);
  const pay = paymentStateOf(inv);
  const overdue = overdueDaysOf(inv);
  const payable = (inv.kind ?? "receivable") === "payable";
  const party = inv.vendor?.name ?? inv.counterparty;
  const lines = inv.lines ?? [];

  return (
    <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm">
      <div className="p-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" className="flex items-center gap-1.5 text-left" onClick={() => setOpen((v) => !v)}>
              {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              <span className="font-medium text-primary">{inv.referenceNo}</span>
            </button>
            <Badge variant="outline" className={`text-[10px] ${PAYMENT_STATE_CLASS[pay.key] ?? ""}`}>{pay.label}</Badge>
            {overdue > 0 && (
              <Badge variant="outline" className="text-[10px] gap-1 bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300">
                <AlertTriangle className="w-3 h-3" /> {overdue}d overdue
              </Badge>
            )}
          </div>

          <p className="text-sm mt-1">
            <span className="font-semibold">{money(inv.totalAmount, inv.currency)}</span>
            {pay.key !== "void" && pay.key !== "paid" && (
              <span className="text-muted-foreground"> · {money(pay.outstanding, inv.currency)} outstanding</span>
            )}
            {pay.key === "paid" && <span className="text-muted-foreground"> · settled in full</span>}
          </p>

          <p className="text-xs text-muted-foreground mt-0.5">
            {payable && party ? `Vendor: ${party} · ` : ""}
            {inv.dueDate ? `Due ${fmtDate(inv.dueDate)}` : pay.notYetIssued ? `Not yet ${payable ? "approved for payment" : "issued"}` : "No due date"}
          </p>
          {inv.status === "void" && inv.voidReason && (
            <p className="text-xs text-muted-foreground mt-0.5">Voided — {inv.voidReason}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {inv.status === "draft" && hasPermission("invoice.issue") && (
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={onIssue}>
              {payable ? "Approve" : "Issue"}
            </Button>
          )}
          {["issued", "part_paid"].includes(inv.status) && hasPermission("payment.record") && (
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={onPay}>Record payment</Button>
          )}
          {["draft", "issued"].includes(inv.status) && hasPermission("invoice.void") && (
            <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" disabled={busy} onClick={onVoid}>Void</Button>
          )}
          {inv.shipmentId && (
            <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={onOpenShipment}>
              <Ship className="w-3.5 h-3.5" /> {inv.shipment?.referenceNo ?? "Shipment"} <ExternalLink className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t bg-muted/20 px-4 py-3 grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Charge lines</p>
            {lines.length === 0 ? (
              <p className="text-xs text-muted-foreground">No line breakdown recorded.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate">{l.description}</span>
                      <span className="text-muted-foreground">{Number(l.quantity)} × {money(l.unitPrice, inv.currency)}</span>
                    </span>
                    <span className="shrink-0 font-medium">{money(l.amount, inv.currency)}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 pt-1 border-t font-semibold">
                  <span>Total</span><span>{money(inv.totalAmount, inv.currency)}</span>
                </li>
              </ul>
            )}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <span className="text-muted-foreground">Type <b className="text-foreground font-medium">{INVOICE_KIND_LABELS[inv.kind ?? "receivable"]}</b></span>
              <span className="text-muted-foreground">Stage <b className="text-foreground font-medium">{INVOICE_STATUS_LABELS[inv.status]}</b></span>
              <span className="text-muted-foreground">Issued <b className="text-foreground font-medium">{fmtDate(inv.issuedAt)}</b></span>
              <span className="text-muted-foreground">Due <b className="text-foreground font-medium">{fmtDate(inv.dueDate)}</b></span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Payments</p>
              {(inv.payments ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing received yet.</p>
              ) : (
                <ul className="space-y-0.5 text-xs">
                  {inv.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground truncate">
                        {fmtDate(p.receivedAt)} · {(p.method || "").replace(/_/g, " ")}{p.referenceNumber ? ` · ${p.referenceNumber}` : ""}
                      </span>
                      <span className="shrink-0 font-medium text-emerald-600 dark:text-emerald-400">{money(p.amount, inv.currency)}</span>
                    </li>
                  ))}
                  {pay.outstanding > 0 && (
                    <li className="flex items-center justify-between gap-3 pt-1 border-t font-semibold">
                      <span>Outstanding</span><span>{money(pay.outstanding, inv.currency)}</span>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PaymentDialog = ({ busy, invoice, onClose, onSubmit }) => {
  const pay = invoice ? paymentStateOf(invoice) : null;
  const [amount, setAmount] = useState(pay ? String(pay.outstanding) : "");
  const [method, setMethod] = useState("bank_transfer");
  const [ref, setRef] = useState("");
  const over = pay && Number(amount) > pay.outstanding + 0.001;
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            {invoice ? `${invoice.referenceNo} — ${money(pay.outstanding, invoice.currency)} outstanding. ` : ""}
            Full settlement auto-completes OTC milestone 2 (RULE-FI-03).
          </DialogDescription></DialogHeader>
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
          {over && <p className="text-[11px] text-amber-600 dark:text-amber-400">That is more than the outstanding balance — the invoice will still settle in full.</p>}
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

/* ── Raise an invoice against a shipment, straight from the finance desk. ── */
const CreateInvoiceDialog = ({ busy, shipments = [], vendors = [], defaultKind, onClose, onSubmit }) => {
  const [shipmentId, setShipmentId] = useState("");
  const [kind, setKind] = useState(defaultKind || "receivable");
  const [vendorId, setVendorId] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState([{ description: "", quantity: 1, unitPrice: "" }]);

  const setLine = (i, k, v) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((p) => [...p, { description: "", quantity: 1, unitPrice: "" }]);
  const removeLine = (i) => setLines((p) => p.filter((_, idx) => idx !== i));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);

  const submit = (e) => {
    e.preventDefault();
    if (!shipmentId) return toast.error("Pick the shipment this invoice belongs to");
    if (kind === "payable" && !vendorId && !counterparty.trim()) return toast.error("A payable needs a vendor or counterparty (who we owe)");
    const clean = lines.filter((l) => l.description.trim() && l.unitPrice !== "" && Number(l.unitPrice) >= 0);
    if (!clean.length) return toast.error("Add at least one charge line with a price");
    onSubmit({
      shipmentId,
      kind,
      vendorId: kind === "payable" && vendorId ? vendorId : undefined,
      counterparty: kind === "payable" && !vendorId ? counterparty.trim() : undefined,
      currency,
      dueDate: dueDate || undefined,
      lines: clean.map((l, i) => ({ description: l.description.trim(), quantity: Number(l.quantity) || 1, unitPrice: Number(l.unitPrice), sortOrder: i })),
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>New invoice</DialogTitle>
          <DialogDescription>Receivable = the customer owes us; Payable = we owe a vendor/carrier. It is created as a draft — issue it separately.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4 py-2">
          <div className="space-y-1.5"><Label>Shipment</Label>
            <Select value={shipmentId || "none"} onValueChange={(v) => setShipmentId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select a shipment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— select —</SelectItem>
                {shipments.map((s) => <SelectItem key={s.id} value={s.id}>{s.referenceNo} · {s.customerCompany}</SelectItem>)}
              </SelectContent>
            </Select>
            {shipments.length === 0 && <p className="text-[11px] text-muted-foreground">No open shipments available.</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="receivable">Receivable (owed to us)</SelectItem>
                  <SelectItem value="payable">Payable (we owe)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="fi-ccy">Currency</Label>
              <Input id="fi-ccy" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
            <div className="space-y-1.5"><Label htmlFor="fi-due">Due date (optional)</Label>
              <Input id="fi-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>

          {kind === "payable" && (
            <div className="space-y-1.5"><Label>Vendor (who we owe)</Label>
              <Select value={vendorId || "none"} onValueChange={(v) => setVendorId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select a vendor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— free-text below —</SelectItem>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {!vendorId && <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="e.g. Maersk, ABC Trucking" />}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label>Charge lines</Label>
              <Button type="button" size="sm" variant="outline" className="gap-1 h-8" onClick={addLine}><Plus className="w-3.5 h-3.5" /> Add line</Button></div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <Input className="col-span-6" placeholder="Description" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} />
                <Input className="col-span-2" type="number" min="0" step="0.01" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} />
                <Input className="col-span-3" type="number" min="0" step="0.01" placeholder="Unit price" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} />
                <button type="button" className="col-span-1 text-muted-foreground hover:text-destructive disabled:opacity-30" onClick={() => removeLine(i)} disabled={lines.length === 1} aria-label="Remove line"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <div className="text-right text-sm font-semibold">Total: {money(total, currency)}</div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create draft"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default FinanceListPage;
