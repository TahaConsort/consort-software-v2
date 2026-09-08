import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, FileText, Plus, Loader2, AlertTriangle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { FI_TYPE_LABELS, FI_STATUS_LABELS, FI_STATUS_CLASS, TRADE_CONTRACT_STATUS_LABELS } from "@/lib/catalog";
import * as tradeService from "@/services/tradeService";
import { listVendors } from "@/services/vendorService";

/**
 * The two registers that exist BEFORE a shipment does (Export Shipment Workflow roadmap
 * Step 1): the sales contract / proforma, and the Financial Instrument the vendor bank
 * registers against it.
 *
 * The instruments board is where §7.2's first automatic flag lives — an instrument
 * inside 14 days of expiry is what the nightly sweep also notifies on, surfaced here so
 * Accounts can see the whole book at a glance rather than one shipment at a time.
 */

const money = (n, ccy) =>
  n == null
    ? "—"
    : `${ccy ?? ""} ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const daysTo = (d) => (d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null);

const Field = ({ label, value, onChange, type = "text", placeholder, required }) => (
  <label className="block min-w-0">
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
      {required ? " *" : ""}
    </span>
    <Input
      className="h-8 text-xs mt-0.5"
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  </label>
);

const TradeRegistersPage = () => {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canContract = hasPermission("trade.contract.manage");
  const canFi = hasPermission("fi.manage");
  const canClose = hasPermission("fi.close");

  const [tab, setTab] = useState("instruments");
  const [contracts, setContracts] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // "contract" | "instrument"
  const [form, setForm] = useState({});
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async (alive = () => true) => {
    try {
      const [c, i, v] = await Promise.all([
        tradeService.listContracts(),
        tradeService.listInstruments(),
        listVendors({ isActive: true }),
      ]);
      if (!alive()) return;
      setContracts(c.data ?? []);
      setInstruments(i.data ?? []);
      setVendors(v.data ?? []);
    } catch (err) {
      if (alive()) toast.error(err?.message || "Could not load the trade registers");
    } finally {
      if (alive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    // load() is async: every setState runs in an await continuation, guarded by `mounted`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(() => mounted);
    return () => {
      mounted = false;
    };
  }, [load]);

  const act = async (fn, msg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(msg || res?.message || "Saved");
      setDialog(null);
      setForm({});
      await load();
      return res;
    } catch (err) {
      toast.error(err?.message || "That did not save");
      return null;
    } finally {
      setBusy(false);
    }
  };

  // The expiry board — §7.2's first flag, as a set of counters over the live list.
  const board = useMemo(() => {
    const active = instruments.filter((f) => f.status === "active");
    return {
      active: active.length,
      expiring: active.filter((f) => {
        const d = daysTo(f.expiryDate);
        return d !== null && d >= 0 && d <= 14;
      }).length,
      expired: instruments.filter((f) => f.status === "expired").length,
      closed: instruments.filter((f) => f.status === "closed").length,
    };
  }, [instruments]);

  const visibleInstruments = useMemo(() => {
    if (statusFilter === "all") return instruments;
    if (statusFilter === "expiring") {
      return instruments.filter((f) => {
        const d = daysTo(f.expiryDate);
        return f.status === "active" && d !== null && d >= 0 && d <= 14;
      });
    }
    return instruments.filter((f) => f.status === statusFilter);
  }, [instruments, statusFilter]);

  /** Suggested types first, then everything — ordered, never filtered (roadmap §1). */
  const vendorOptions = (preferred) => {
    const rank = (v) => (preferred.includes(v.type) ? 0 : 1);
    return [...vendors].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Trade</h1>
        <p className="text-sm text-muted-foreground">
          Contracts and bank instruments are registered here, before a shipment exists — the export cycle starts with the
          order and the bank registration, not with a booking.
        </p>
      </div>

      <div className="flex gap-1 border-b pb-2">
        {[
          { key: "instruments", label: "Financial Instruments", icon: Landmark },
          { key: "contracts", label: "Contracts", icon: FileText },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`text-sm px-3 py-1.5 rounded-md flex items-center gap-1.5 ${
              tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "instruments" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { key: "active", label: "Active", value: board.active },
              { key: "expiring", label: "Expiring in 14 days", value: board.expiring, warn: board.expiring > 0 },
              { key: "expired", label: "Expired", value: board.expired, bad: board.expired > 0 },
              { key: "closed", label: "Closed", value: board.closed },
            ].map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setStatusFilter(statusFilter === c.key ? "all" : c.key)}
                className={`border rounded-xl p-4 text-left ${statusFilter === c.key ? "ring-2 ring-primary" : ""} ${
                  c.bad ? "border-destructive/40" : c.warn ? "border-amber-400/50" : ""
                }`}
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</p>
                <p className={`text-2xl font-semibold ${c.bad ? "text-destructive" : c.warn ? "text-amber-600" : ""}`}>
                  {c.value}
                </p>
              </button>
            ))}
          </div>

          {canFi && !dialog && (
            <Button
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => {
                setDialog("instrument");
                setForm({ currency: "EUR", type: "exp_form" });
              }}
            >
              <Plus className="w-3.5 h-3.5" /> Register an instrument
            </Button>
          )}

          {dialog === "instrument" && (
            <div className="border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">New financial instrument</p>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Cancel" onClick={() => setDialog(null)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field
                  label="Bank FI number"
                  required
                  value={form.fiNumber}
                  onChange={(v) => setForm({ ...form, fiNumber: v })}
                  placeholder="BIP-EXP-296937-14112025"
                />
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Type</span>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(FI_TYPE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Vendor (exporter) *</span>
                  <Select value={form.vendorId} onValueChange={(v) => setForm({ ...form, vendorId: v })}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Pick a vendor" /></SelectTrigger>
                    <SelectContent>
                      {vendorOptions(["exporter"]).map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Bank *</span>
                  <Select value={form.bankVendorId} onValueChange={(v) => setForm({ ...form, bankVendorId: v })}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Pick a bank" /></SelectTrigger>
                    <SelectContent>
                      {vendorOptions(["bank"]).map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <Field label="Currency" required value={form.currency} onChange={(v) => setForm({ ...form, currency: v.toUpperCase() })} />
                <Field label="Value" required type="number" value={form.value} onChange={(v) => setForm({ ...form, value: v })} />
                <Field label="Incoterm" value={form.incoterm} onChange={(v) => setForm({ ...form, incoterm: v })} placeholder="CFR" />
                <Field label="Port of discharge" value={form.portOfDischarge} onChange={(v) => setForm({ ...form, portOfDischarge: v })} />
                <Field label="CAD %" type="number" value={form.cadPercent} onChange={(v) => setForm({ ...form, cadPercent: v })} />
                <Field label="DA %" type="number" value={form.daPercent} onChange={(v) => setForm({ ...form, daPercent: v })} />
                <Field label="DA days from B/L" type="number" value={form.daDays} onChange={(v) => setForm({ ...form, daDays: v })} />
                <Field label="Expiry date" required type="date" value={form.expiryDate} onChange={(v) => setForm({ ...form, expiryDate: v })} />
              </div>
              <p className="text-[10px] text-muted-foreground">
                The CAD/DA split and the DA days are what let the system compute the payment due date from the actual Bill
                of Lading date, instead of asking anyone to remember it.
              </p>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={busy || !form.fiNumber || !form.vendorId || !form.bankVendorId || !form.value || !form.expiryDate}
                onClick={() =>
                  act(
                    () =>
                      tradeService.createInstrument({
                        fiNumber: form.fiNumber,
                        type: form.type,
                        vendorId: form.vendorId,
                        bankVendorId: form.bankVendorId,
                        currency: form.currency,
                        value: Number(form.value),
                        incoterm: form.incoterm || undefined,
                        portOfDischarge: form.portOfDischarge || undefined,
                        cadPercent: form.cadPercent ? Number(form.cadPercent) : undefined,
                        daPercent: form.daPercent ? Number(form.daPercent) : undefined,
                        daDays: form.daDays ? Number(form.daDays) : undefined,
                        expiryDate: form.expiryDate,
                      }),
                    "Instrument registered",
                  )
                }
              >
                Register
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {visibleInstruments.length === 0 && <p className="text-sm text-muted-foreground">No instruments here.</p>}
            {visibleInstruments.map((fi) => {
              const left = daysTo(fi.expiryDate);
              const warn = fi.status === "active" && left !== null && left <= 14;
              return (
                <div key={fi.id} className="border rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {fi.fiNumber} <span className="text-muted-foreground text-sm">· {fi.referenceNo}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fi.vendor?.name} → {fi.bank?.bankName ?? fi.bank?.name} · {FI_TYPE_LABELS[fi.type] ?? fi.type}
                      </p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] ${FI_STATUS_CLASS[fi.status] ?? ""}`}>
                      {FI_STATUS_LABELS[fi.status] ?? fi.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 text-sm">
                    <div><p className="text-[10px] uppercase text-muted-foreground">Value</p>{money(fi.value, fi.currency)}</div>
                    <div><p className="text-[10px] uppercase text-muted-foreground">Drawn</p>{money(fi.drawnAmount, fi.currency)}</div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Outstanding</p>
                      {money(Number(fi.value) - Number(fi.drawnAmount), fi.currency)}
                    </div>
                    <div><p className="text-[10px] uppercase text-muted-foreground">Expiry</p>{fmtDate(fi.expiryDate)}</div>
                    <div><p className="text-[10px] uppercase text-muted-foreground">Shipments</p>{fi._count?.shipments ?? 0}</div>
                  </div>
                  {warn && (
                    <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {left < 0 ? `Expired ${Math.abs(left)} day(s) ago` : `Expires in ${left} day(s)`}
                    </p>
                  )}
                  {canClose && fi.status !== "closed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] mt-3"
                      disabled={busy}
                      onClick={() => {
                        const outstanding = Number(fi.value) - Number(fi.drawnAmount);
                        const reason =
                          outstanding > 0
                            ? window.prompt(`${money(outstanding, fi.currency)} has not been realised. Why close it now?`)
                            : undefined;
                        if (outstanding > 0 && !reason) return;
                        act(
                          () => tradeService.closeInstrument(fi.id, { force: outstanding > 0, reason: reason || undefined }),
                          "Instrument closed",
                        );
                      }}
                    >
                      Close instrument
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "contracts" && (
        <>
          {canContract && !dialog && (
            <Button
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => {
                setDialog("contract");
                setForm({ currency: "EUR", direction: "export" });
              }}
            >
              <Plus className="w-3.5 h-3.5" /> Register a contract
            </Button>
          )}

          {dialog === "contract" && (
            <div className="border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">New trade contract</p>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Cancel" onClick={() => setDialog(null)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field
                  label="Contract no."
                  required
                  value={form.contractNo}
                  onChange={(v) => setForm({ ...form, contractNo: v })}
                  placeholder="AST/09/25/002"
                />
                <Field label="Contract date" type="date" value={form.contractDate} onChange={(v) => setForm({ ...form, contractDate: v })} />
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Vendor *</span>
                  <Select value={form.vendorId} onValueChange={(v) => setForm({ ...form, vendorId: v })}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Pick a vendor" /></SelectTrigger>
                    <SelectContent>
                      {vendorOptions(["exporter"]).map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Direction</span>
                  <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="export">Export</SelectItem>
                      <SelectItem value="import">Import</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <Field label="Currency" required value={form.currency} onChange={(v) => setForm({ ...form, currency: v.toUpperCase() })} />
                <Field label="Value" type="number" value={form.totalValue} onChange={(v) => setForm({ ...form, totalValue: v })} />
                <Field label="Incoterm" value={form.incoterm} onChange={(v) => setForm({ ...form, incoterm: v })} placeholder="CFR" />
                <Field
                  label="Payment terms"
                  value={form.paymentTerms}
                  onChange={(v) => setForm({ ...form, paymentTerms: v })}
                  placeholder="60% CAD / 40% DA 75 days"
                />
              </div>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={busy || !form.contractNo || !form.vendorId || !form.currency}
                onClick={() =>
                  act(
                    () =>
                      tradeService.createContract({
                        contractNo: form.contractNo,
                        contractDate: form.contractDate || undefined,
                        vendorId: form.vendorId,
                        direction: form.direction,
                        currency: form.currency,
                        totalValue: form.totalValue ? Number(form.totalValue) : undefined,
                        incoterm: form.incoterm || undefined,
                        paymentTerms: form.paymentTerms || undefined,
                      }),
                    "Contract registered",
                  )
                }
              >
                Register
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {contracts.length === 0 && <p className="text-sm text-muted-foreground">No contracts registered.</p>}
            {contracts.map((c) => (
              <div key={c.id} className="border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {c.contractNo} <span className="text-muted-foreground text-sm">· {c.referenceNo}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.vendor?.name} · {fmtDate(c.contractDate)} · {c.direction}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {TRADE_CONTRACT_STATUS_LABELS[c.status] ?? c.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
                  <div><p className="text-[10px] uppercase text-muted-foreground">Value</p>{money(c.totalValue, c.currency)}</div>
                  <div><p className="text-[10px] uppercase text-muted-foreground">Incoterm</p>{c.incoterm ?? "—"}</div>
                  <div><p className="text-[10px] uppercase text-muted-foreground">Instruments</p>{c._count?.financialInstruments ?? 0}</div>
                  <div><p className="text-[10px] uppercase text-muted-foreground">Shipments</p>{c._count?.shipments ?? 0}</div>
                </div>
                {c.paymentTerms && <p className="text-[11px] text-muted-foreground mt-2">{c.paymentTerms}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default TradeRegistersPage;
