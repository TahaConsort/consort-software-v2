import { useCallback, useEffect, useState } from "react";
import {
  FileSpreadsheet, Package, Receipt, Ship, Stamp, Landmark, AlertTriangle,
  Loader2, Plus, Trash2, CheckCircle2, FileDown, Save,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import {
  TRADE_STAGE_ORDER, labelForTradeStage, FI_TYPE_LABELS, FI_STATUS_LABELS,
  TRADE_INVOICE_SIDE_LABELS, FREIGHT_TERMS_LABELS, DEFAULT_CURRENCY,
} from "@/lib/catalog";
import * as tradeService from "@/services/tradeService";

/**
 * The structured export document pack for one shipment (roadmap §4).
 *
 * Everything here is data the paperwork already carries; the point of holding it rather
 * than a scan is that each document feeds the next as a foreign key (§6), which is what
 * removes the retyping the roadmap closes on (§8).
 *
 * The stage bar at the top is DERIVED server-side from which documents exist — there is
 * no control anywhere in this component that sets it, exactly as with shipment status.
 *
 * Permission gating mirrors the API, so a user sees documents their department does not
 * own as read-only rather than not at all: Compliance can read the B/L Operations filed,
 * and Operations can read the declaration Compliance filed.
 */

const money = (n, ccy) =>
  n == null
    ? "—"
    : `${ccy ?? ""} ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
const dateVal = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const TABS = [
  { key: "contract", label: "Contract & FI", icon: Landmark },
  { key: "containers", label: "Containers", icon: Package },
  { key: "packing", label: "Packing List", icon: FileSpreadsheet },
  { key: "invoices", label: "Commercial Invoice", icon: Receipt },
  { key: "bol", label: "Bill of Lading", icon: Ship },
  { key: "gd", label: "Goods Declaration", icon: Stamp },
];

/** A labelled read-only fact. */
const Fact = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="text-sm truncate">{value ?? "—"}</p>
  </div>
);

/** A labelled input bound to a form object. */
const Field = ({ label, value, onChange, type = "text", disabled, placeholder }) => (
  <label className="block min-w-0">
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    <Input
      className="h-8 text-xs mt-0.5"
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  </label>
);

const TradeDocumentsPanel = ({ shipment }) => {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const shipmentId = shipment.id;

  const can = {
    cargo: hasPermission("trade.cargo.manage"),
    invoice: hasPermission("trade.invoice.manage"),
    issue: hasPermission("trade.invoice.issue"),
    transport: hasPermission("trade.transport.manage"),
    customs: hasPermission("trade.customs.manage"),
    fi: hasPermission("fi.manage"),
  };
  // A closed or cancelled order freezes the pack — the server says the same thing.
  const frozen = shipment.status === "closed" || shipment.exceptionState === "cancelled";

  const [tab, setTab] = useState("contract");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (alive = () => true) => {
      try {
        const res = await tradeService.getTradeOverview(shipmentId);
        if (alive()) setData(res.data);
      } catch (err) {
        if (alive() && err?.status && ![403, 404].includes(err.status)) {
          toast.error(err?.message || "Could not load the trade documents");
        }
      } finally {
        if (alive()) setLoading(false);
      }
    },
    [shipmentId],
  );

  useEffect(() => {
    let mounted = true;
    // load() is async: every setState runs in an await continuation and is guarded by
    // the `mounted` flag above, so nothing is set synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(() => mounted);
    return () => {
      mounted = false;
    };
  }, [load]);

  /** Run a write, toast, refresh. */
  const act = async (fn, msg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(msg || res?.message || "Saved");
      await load();
      return res;
    } catch (err) {
      toast.error(err?.message || "That did not save");
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading trade documents…
      </div>
    );
  }
  if (!data) return null;

  const stageIndex = TRADE_STAGE_ORDER.indexOf(data.tradeStage);

  return (
    <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" /> Trade Documents
        </h2>
        <Badge variant="outline" className="text-[11px]">{labelForTradeStage(data.tradeStage)}</Badge>
      </div>

      {/* Roadmap §7.1 — derived from the documents, never set by hand. */}
      <ol className="flex flex-wrap gap-1.5">
        {TRADE_STAGE_ORDER.map((stage, i) => {
          const done = stageIndex >= i;
          return (
            <li
              key={stage}
              className={`text-[10px] px-2 py-1 rounded-full border ${
                done
                  ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "text-muted-foreground border-muted-foreground/25"
              }`}
            >
              {i + 1}. {labelForTradeStage(stage)}
            </li>
          );
        })}
      </ol>

      {/* §7.2 — reported, never blocking. */}
      {(data.alerts ?? []).length > 0 && (
        <ul className="space-y-1">
          {data.alerts.map((a, i) => (
            <li
              key={i}
              className={`text-xs flex items-start gap-1.5 ${a.severity === "error" ? "text-destructive" : "text-amber-600"}`}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{a.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-1 border-b pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1.5 ${
              tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "contract" && <ContractTab data={data} />}
      {tab === "containers" && (
        <ContainersTab data={data} shipmentId={shipmentId} canEdit={can.cargo && !frozen} busy={busy} act={act} />
      )}
      {tab === "packing" && (
        <PackingTab
          key={data.packingList?.updatedAt ?? "new"}
          data={data}
          shipmentId={shipmentId}
          canEdit={can.cargo && !frozen}
          busy={busy}
          act={act}
        />
      )}
      {tab === "invoices" && (
        <InvoicesTab data={data} shipmentId={shipmentId} can={can} frozen={frozen} busy={busy} act={act} />
      )}
      {tab === "bol" && (
        <BolTab
          key={data.billOfLading?.updatedAt ?? "new"}
          data={data}
          shipmentId={shipmentId}
          canEdit={can.transport && !frozen}
          busy={busy}
          act={act}
        />
      )}
      {tab === "gd" && (
        <GdTab
          key={data.goodsDeclaration?.updatedAt ?? "new"}
          data={data}
          shipmentId={shipmentId}
          canEdit={can.customs && !frozen}
          busy={busy}
          act={act}
        />
      )}
    </div>
  );
};

/* ── §4.1/§4.2 — read-only here; both are registered before the shipment ───── */
const ContractTab = ({ data }) => {
  const c = data.contract;
  const fi = data.financialInstrument;
  if (!c && !fi) {
    return (
      <p className="text-sm text-muted-foreground">
        This shipment was not raised from a trade contract. Contracts and financial instruments are registered under
        Trade → Contracts before a shipment exists.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {c && (
        <div>
          <p className="text-xs font-semibold mb-2">Sales Contract / Proforma</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Fact label="Contract no." value={c.contractNo} />
            <Fact label="Reference" value={c.referenceNo} />
            <Fact label="Date" value={fmtDate(c.contractDate)} />
            <Fact label="Vendor" value={c.vendor?.name} />
            <Fact label="Incoterm" value={c.incoterm} />
            <Fact label="Value" value={money(c.totalValue, c.currency)} />
            <Fact label="Payment terms" value={c.paymentTerms} />
            <Fact label="Status" value={c.status} />
          </div>
        </div>
      )}
      {fi && (
        <div className="border-t pt-3">
          <p className="text-xs font-semibold mb-2">Financial Instrument (bank registration)</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Fact label="FI number" value={fi.fiNumber} />
            <Fact label="Type" value={FI_TYPE_LABELS[fi.type] ?? fi.type} />
            <Fact label="Bank" value={fi.bank?.bankName ?? fi.bank?.name} />
            <Fact label="Status" value={FI_STATUS_LABELS[fi.status] ?? fi.status} />
            <Fact label="Value" value={money(fi.value, fi.currency)} />
            <Fact label="Drawn" value={money(fi.drawnAmount, fi.currency)} />
            <Fact label="Expiry" value={fmtDate(fi.expiryDate)} />
            <Fact
              label="Payment split"
              value={
                fi.cadPercent || fi.daPercent
                  ? `${fi.cadPercent ?? 0}% CAD / ${fi.daPercent ?? 0}% DA ${fi.daDays ?? 0}d`
                  : fi.paymentTermsText
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};

/* ── §7 Containers ────────────────────────────────────────────────────────── */
const ContainersTab = ({ data, shipmentId, canEdit, busy, act }) => {
  const [form, setForm] = useState({ containerNo: "", sealNo: "", containerTypeCode: "" });
  return (
    <div className="space-y-3">
      {(data.containers ?? []).length === 0 && <p className="text-sm text-muted-foreground">No containers recorded.</p>}
      <ul className="space-y-1.5">
        {(data.containers ?? []).map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2 text-sm">
            <span className="truncate">
              <span className="font-medium">{c.containerNo}</span>
              <span className="text-muted-foreground"> · seal {c.sealNo ?? "—"} · {c.containerTypeCode ?? "—"}</span>
            </span>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-destructive"
                aria-label="Remove container"
                disabled={busy}
                onClick={() => act(() => tradeService.removeContainer(shipmentId, c.id), "Container removed")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end border-t pt-3">
          <Field label="Container no." value={form.containerNo} onChange={(v) => setForm({ ...form, containerNo: v })} />
          <Field label="Seal no." value={form.sealNo} onChange={(v) => setForm({ ...form, sealNo: v })} />
          <Field
            label="Type"
            value={form.containerTypeCode}
            onChange={(v) => setForm({ ...form, containerTypeCode: v })}
            placeholder="40HC"
          />
          <Button
            size="sm"
            className="h-8 text-xs gap-1"
            disabled={busy || !form.containerNo}
            onClick={async () => {
              const r = await act(
                () =>
                  tradeService.addContainer(shipmentId, {
                    ...form,
                    sealNo: form.sealNo || undefined,
                    containerTypeCode: form.containerTypeCode || undefined,
                  }),
                "Container added",
              );
              if (r) setForm({ containerNo: "", sealNo: "", containerTypeCode: "" });
            }}
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      )}
    </div>
  );
};

/* ── §4.3 Packing List ────────────────────────────────────────────────────── */
const PackingTab = ({ data, shipmentId, canEdit, busy, act }) => {
  const pl = data.packingList;
  // Seeded once; the parent remounts this tab (key on `updatedAt`) whenever the
  // server returns a newer packing list, so there is no prop-to-state sync effect.
  const [items, setItems] = useState(() => pl?.items ?? []);

  const blank = {
    skuRef: "", description: "", hsCode: "", qtyPerBox: "", boxes: "", pieces: "", netWeightKg: "", grossWeightKg: "",
  };
  const setItem = (i, key, v) => setItems(items.map((it, j) => (j === i ? { ...it, [key]: v } : it)));
  const numOrUndef = (v) => (v === "" || v == null ? undefined : Number(v));

  if (!pl) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">No packing list yet.</p>
        {canEdit && (
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={busy}
            onClick={() => act(() => tradeService.savePackingList(shipmentId, {}), "Packing list created")}
          >
            Create packing list
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Fact label="Reference" value={pl.referenceNo} />
        <Fact label="Cartons" value={pl.totalCartons} />
        <Fact label="Pieces" value={pl.totalPieces} />
        <Fact label="Net (kg)" value={pl.totalNetWeightKg} />
        <Fact label="Gross (kg)" value={pl.totalGrossWeightKg} />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Totals are computed from the rows below — they are never typed in.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[820px]">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              {["SKU", "Description", "HS Code", "Qty/Box", "Boxes", "Pieces", "Net kg", "Gross kg", ""].map((h) => (
                <th key={h} className="text-left font-medium py-1.5 pr-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b last:border-0">
                {["skuRef", "description", "hsCode", "qtyPerBox", "boxes", "pieces", "netWeightKg", "grossWeightKg"].map((k) => (
                  <td key={k} className="py-1 pr-2">
                    <Input
                      className="h-7 text-xs"
                      disabled={!canEdit}
                      value={it[k] ?? ""}
                      onChange={(e) => setItem(i, k, e.target.value)}
                    />
                  </td>
                ))}
                <td className="py-1">
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive"
                      aria-label="Remove row"
                      onClick={() => setItems(items.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => setItems([...items, { ...blank }])}>
            <Plus className="w-3.5 h-3.5" /> Add row
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs gap-1"
            disabled={busy}
            onClick={() =>
              act(
                () =>
                  tradeService.savePackingListItems(
                    shipmentId,
                    items
                      .filter((it) => it.description)
                      .map((it) => ({
                        skuRef: it.skuRef || undefined,
                        description: it.description,
                        hsCode: it.hsCode || undefined,
                        qtyPerBox: numOrUndef(it.qtyPerBox),
                        boxes: numOrUndef(it.boxes),
                        pieces: numOrUndef(it.pieces),
                        netWeightKg: numOrUndef(it.netWeightKg),
                        grossWeightKg: numOrUndef(it.grossWeightKg),
                      })),
                  ),
                "Packing list saved",
              )
            }
          >
            <Save className="w-3.5 h-3.5" /> Save rows
          </Button>
          {!pl.confirmedAt && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1"
              disabled={busy}
              onClick={() => act(() => tradeService.confirmPackingList(shipmentId), "Packing list confirmed")}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            disabled={busy}
            onClick={() => act(() => tradeService.generatePackingListPdf(shipmentId), "Packing list generated")}
          >
            <FileDown className="w-3.5 h-3.5" /> Generate PDF
          </Button>
        </div>
      )}
      {pl.confirmedAt && <p className="text-[11px] text-emerald-600">Confirmed {fmtDate(pl.confirmedAt)}.</p>}
    </div>
  );
};

/* ── §4.4 Commercial Invoice ──────────────────────────────────────────────── */
const InvoicesTab = ({ data, shipmentId, can, frozen, busy, act }) => {
  const [creating, setCreating] = useState(null); // "purchase" | "sale"
  const [form, setForm] = useState({ invoiceNo: "", invoiceDate: "", currency: DEFAULT_CURRENCY });
  const [openId, setOpenId] = useState(null);
  const invoices = data.tradeInvoices ?? [];

  // The side rule, mirrored from the server: Operations records the vendor purchase
  // invoice, Accounts raises and issues the sale invoice.
  const mayWrite = (side) => (side === "sale" ? can.issue : can.invoice) && !frozen;

  return (
    <div className="space-y-3">
      {invoices.length === 0 && <p className="text-sm text-muted-foreground">No commercial invoice recorded.</p>}

      {invoices.map((inv) => (
        <div key={inv.id} className="border rounded-lg p-3 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {inv.invoiceNo} <span className="text-muted-foreground">· {inv.referenceNo}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {TRADE_INVOICE_SIDE_LABELS[inv.side]} · {fmtDate(inv.invoiceDate)} · {money(inv.totalValue, inv.currency)}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">{inv.status}</Badge>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={() => setOpenId(openId === inv.id ? null : inv.id)}
              >
                {openId === inv.id ? "Hide" : "Lines"}
              </Button>
            </div>
          </div>

          {openId === inv.id && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[600px]">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      {["Description", "HS Code", "Qty", "Unit", "Unit price", "Amount"].map((h) => (
                        <th key={h} className="text-left font-medium py-1.5 pr-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(inv.lines ?? []).map((l) => (
                      <tr key={l.id} className="border-b last:border-0">
                        <td className="py-1 pr-2">{l.description}</td>
                        <td className="py-1 pr-2">{l.hsCode ?? "—"}</td>
                        <td className="py-1 pr-2">{l.quantity}</td>
                        <td className="py-1 pr-2">{l.unitOfMeasure ?? "—"}</td>
                        <td className="py-1 pr-2">{l.unitPrice}</td>
                        <td className="py-1 pr-2">{l.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mayWrite(inv.side) && (
                <div className="flex flex-wrap gap-2">
                  {inv.status === "draft" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        disabled={busy}
                        onClick={() => act(() => tradeService.seedInvoiceFromPackingList(shipmentId, inv.id))}
                      >
                        Seed lines from packing list
                      </Button>
                      {can.issue && (
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={busy}
                          onClick={() => act(() => tradeService.issueTradeInvoice(shipmentId, inv.id))}
                        >
                          Issue
                        </Button>
                      )}
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] gap-1"
                    disabled={busy}
                    onClick={() => act(() => tradeService.generateInvoicePdf(shipmentId, inv.id), "Invoice generated")}
                  >
                    <FileDown className="w-3.5 h-3.5" /> Generate PDF
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {!frozen && (can.invoice || can.issue) && (
        <div className="border-t pt-3 space-y-2">
          {!creating ? (
            <div className="flex gap-2">
              {can.invoice && (
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => setCreating("purchase")}>
                  <Plus className="w-3.5 h-3.5" /> Vendor purchase invoice
                </Button>
              )}
              {can.issue && (
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => setCreating("sale")}>
                  <Plus className="w-3.5 h-3.5" /> Customer sale invoice
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
              <Field label="Invoice no." value={form.invoiceNo} onChange={(v) => setForm({ ...form, invoiceNo: v })} />
              <Field
                label="Invoice date"
                type="date"
                value={form.invoiceDate}
                onChange={(v) => setForm({ ...form, invoiceDate: v })}
              />
              <Field
                label="Currency"
                value={form.currency}
                onChange={(v) => setForm({ ...form, currency: v.toUpperCase() })}
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={busy || !form.invoiceNo || !form.invoiceDate}
                  onClick={async () => {
                    const r = await act(() =>
                      tradeService.createTradeInvoice(shipmentId, {
                        side: creating,
                        invoiceNo: form.invoiceNo,
                        invoiceDate: form.invoiceDate,
                        currency: form.currency,
                        financialInstrumentId: data.financialInstrument?.id,
                      }),
                    );
                    if (r) {
                      setCreating(null);
                      setForm({ invoiceNo: "", invoiceDate: "", currency: DEFAULT_CURRENCY });
                    }
                  }}
                >
                  Create
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setCreating(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ── §4.5 Bill of Lading ──────────────────────────────────────────────────── */
const BolTab = ({ data, shipmentId, canEdit, busy, act }) => {
  const bol = data.billOfLading;
  // Seeded once; the parent remounts this tab when the server returns a newer B/L.
  const [form, setForm] = useState(() => ({
    blNumber: bol?.blNumber ?? "",
    bookingNo: bol?.bookingNo ?? "",
    vesselName: bol?.vesselName ?? "",
    voyageNo: bol?.voyageNo ?? "",
    portOfLoading: bol?.portOfLoading ?? "",
    portOfDischarge: bol?.portOfDischarge ?? "",
    consigneeText: bol?.consigneeText ?? "",
    notifyText: bol?.notifyText ?? "",
    secondNotifyText: bol?.secondNotifyText ?? "",
    freightTerms: bol?.freightTerms ?? "",
    shippedOnBoard: dateVal(bol?.shippedOnBoard),
    issueDate: dateVal(bol?.issueDate),
    netWeightKg: bol?.netWeightKg ?? "",
    grossWeightKg: bol?.grossWeightKg ?? "",
  }));

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const numOrNull = (v) => (v === "" || v == null ? null : Number(v));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="B/L number" value={form.blNumber} onChange={set("blNumber")} disabled={!canEdit} />
        <Field label="Booking no." value={form.bookingNo} onChange={set("bookingNo")} disabled={!canEdit} />
        <Field label="Vessel" value={form.vesselName} onChange={set("vesselName")} disabled={!canEdit} />
        <Field label="Voyage" value={form.voyageNo} onChange={set("voyageNo")} disabled={!canEdit} />
        <Field label="Port of loading" value={form.portOfLoading} onChange={set("portOfLoading")} disabled={!canEdit} />
        <Field label="Port of discharge" value={form.portOfDischarge} onChange={set("portOfDischarge")} disabled={!canEdit} />
        <Field label="Shipped on board" type="date" value={form.shippedOnBoard} onChange={set("shippedOnBoard")} disabled={!canEdit} />
        <Field label="Issued" type="date" value={form.issueDate} onChange={set("issueDate")} disabled={!canEdit} />
        <Field label="Net weight (kg)" value={form.netWeightKg} onChange={set("netWeightKg")} disabled={!canEdit} />
        <Field label="Gross weight (kg)" value={form.grossWeightKg} onChange={set("grossWeightKg")} disabled={!canEdit} />
        <label className="block min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Freight terms</span>
          <Select value={form.freightTerms || undefined} onValueChange={set("freightTerms")} disabled={!canEdit}>
            <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {Object.entries(FREIGHT_TERMS_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field
          label="Consignee (as printed)"
          value={form.consigneeText}
          onChange={set("consigneeText")}
          disabled={!canEdit}
          placeholder="To the order of …"
        />
        <Field label="Notify party" value={form.notifyText} onChange={set("notifyText")} disabled={!canEdit} />
        <Field label="Second notify party" value={form.secondNotifyText} onChange={set("secondNotifyText")} disabled={!canEdit} />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Setting the shipped-on-board date starts the DA clock — the due date is computed from the instrument, never typed in.
      </p>
      {canEdit && (
        <Button
          size="sm"
          className="h-8 text-xs gap-1"
          disabled={busy || !form.blNumber}
          onClick={() =>
            act(
              () =>
                tradeService.saveBillOfLading(shipmentId, {
                  ...form,
                  freightTerms: form.freightTerms || null,
                  shippedOnBoard: form.shippedOnBoard || null,
                  issueDate: form.issueDate || null,
                  netWeightKg: numOrNull(form.netWeightKg),
                  grossWeightKg: numOrNull(form.grossWeightKg),
                  containerIds: (data.containers ?? []).map((c) => c.id),
                }),
              "Bill of Lading saved",
            )
          }
        >
          <Save className="w-3.5 h-3.5" /> Save
        </Button>
      )}
    </div>
  );
};

/* ── §4.6 Goods Declaration ───────────────────────────────────────────────── */
const GdTab = ({ data, shipmentId, canEdit, busy, act }) => {
  const gd = data.goodsDeclaration;
  // Seeded once; the parent remounts this tab when the server returns a newer GD.
  const [form, setForm] = useState(() => ({
    gdNumber: gd?.gdNumber ?? "",
    gdDate: dateVal(gd?.gdDate),
    filedAt: dateVal(gd?.filedAt),
    portOfShipment: gd?.portOfShipment ?? "",
    portOfDischarge: gd?.portOfDischarge ?? "",
    exchangeRate: gd?.exchangeRate ?? "",
    fobValuePkr: gd?.fobValuePkr ?? "",
    freightPkr: gd?.freightPkr ?? "",
    cfrValuePkr: gd?.cfrValuePkr ?? "",
    insurancePkr: gd?.insurancePkr ?? "",
    assessedValuePkr: gd?.assessedValuePkr ?? "",
    appraiserName: gd?.appraiserName ?? "",
    examinerName: gd?.examinerName ?? "",
    outOfChargeAt: dateVal(gd?.outOfChargeAt),
  }));

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const numOrNull = (v) => (v === "" || v == null ? null : Number(v));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="GD number" value={form.gdNumber} onChange={set("gdNumber")} disabled={!canEdit} />
        <Field label="GD date" type="date" value={form.gdDate} onChange={set("gdDate")} disabled={!canEdit} />
        <Field label="Filed" type="date" value={form.filedAt} onChange={set("filedAt")} disabled={!canEdit} />
        <Field label="Out of charge" type="date" value={form.outOfChargeAt} onChange={set("outOfChargeAt")} disabled={!canEdit} />
        <Field label="Port of shipment" value={form.portOfShipment} onChange={set("portOfShipment")} disabled={!canEdit} />
        <Field label="Port of discharge" value={form.portOfDischarge} onChange={set("portOfDischarge")} disabled={!canEdit} />
        <Field label="Exchange rate" value={form.exchangeRate} onChange={set("exchangeRate")} disabled={!canEdit} />
        <Field label="FOB value (PKR)" value={form.fobValuePkr} onChange={set("fobValuePkr")} disabled={!canEdit} />
        <Field label="Freight (PKR)" value={form.freightPkr} onChange={set("freightPkr")} disabled={!canEdit} />
        <Field label="CFR value (PKR)" value={form.cfrValuePkr} onChange={set("cfrValuePkr")} disabled={!canEdit} />
        <Field label="Insurance (PKR)" value={form.insurancePkr} onChange={set("insurancePkr")} disabled={!canEdit} />
        <Field label="Assessed value (PKR)" value={form.assessedValuePkr} onChange={set("assessedValuePkr")} disabled={!canEdit} />
        <Field label="Appraiser" value={form.appraiserName} onChange={set("appraiserName")} disabled={!canEdit} />
        <Field label="Examiner" value={form.examinerName} onChange={set("examinerName")} disabled={!canEdit} />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Customs values are PKR, converted from the invoice currency at the rate above — which is why the rate lives on the
        declaration itself. Appraiser and examiner are the customs officers named on the form, not system users.
      </p>
      {gd?.lines?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[620px]">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                {["HS Code", "Description", "Qty", "Unit value", "Declared PKR", "Assessed PKR", "SRO"].map((h) => (
                  <th key={h} className="text-left font-medium py-1.5 pr-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gd.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-1 pr-2">{l.hsCode}</td>
                  <td className="py-1 pr-2">{l.description}</td>
                  <td className="py-1 pr-2">{l.quantity}</td>
                  <td className="py-1 pr-2">{l.unitValue ?? "—"}</td>
                  <td className="py-1 pr-2">{l.declaredValuePkr ?? "—"}</td>
                  <td className="py-1 pr-2">{l.assessedValuePkr ?? "—"}</td>
                  <td className="py-1 pr-2">{l.sroCode ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <Button
          size="sm"
          className="h-8 text-xs gap-1"
          disabled={busy || !form.gdNumber}
          onClick={() =>
            act(
              () =>
                tradeService.saveGoodsDeclaration(shipmentId, {
                  ...form,
                  gdDate: form.gdDate || null,
                  filedAt: form.filedAt || null,
                  outOfChargeAt: form.outOfChargeAt || null,
                  exchangeRate: numOrNull(form.exchangeRate),
                  fobValuePkr: numOrNull(form.fobValuePkr),
                  freightPkr: numOrNull(form.freightPkr),
                  cfrValuePkr: numOrNull(form.cfrValuePkr),
                  insurancePkr: numOrNull(form.insurancePkr),
                  assessedValuePkr: numOrNull(form.assessedValuePkr),
                }),
              "Goods Declaration saved",
            )
          }
        >
          <Save className="w-3.5 h-3.5" /> Save
        </Button>
      )}
    </div>
  );
};

export default TradeDocumentsPanel;
