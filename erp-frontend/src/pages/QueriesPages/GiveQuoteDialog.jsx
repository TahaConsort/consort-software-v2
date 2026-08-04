import { useState } from "react";
import { Plus, Loader2, Trash2, FileText, Send, Percent, AlertTriangle } from "lucide-react";
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
import toast from "react-hot-toast";
import {
  labelForService, PACKAGE_PRESET_SERVICES, CRO_HANDLING_SHORT, LC_HANDLING_SHORT,
  labelForPackage, routeOf, DEFAULT_CURRENCY,
} from "@/lib/catalog";
import { quoteTemplateFor } from "@/lib/quoteTemplates";

const money = (n, ccy) =>
  `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/**
 * Give Quote — draft (and optionally send) a quotation without leaving the queries
 * list or the rate-request board. Totals are recomputed server-side regardless of
 * what we send (RULE-QT-02).
 *
 * Two ways in:
 *
 *  · No `initialLines` — charge lines are pre-seeded from the PACKAGE template
 *    (lib/quoteTemplates.js) plus a line per add-on service, and Ops fills in the
 *    prices from their own knowledge. This is the queries-list path.
 *
 *  · With `initialLines` — the lines come from vendors who actually quoted, each
 *    carrying its buy price and the vendor who owns it. Ops sets a margin % and the
 *    sell prices are derived, then hand-editable. This is the RFQ path, and it is
 *    the reason the buy side exists: the quote is a resale with a known cost rather
 *    than a number someone remembered.
 *
 * `costAmount`/`costVendorId` ride along to the server, which stores them on the
 * charge line as the job's P&L estimate. They are scrubbed from anything a portal
 * customer can read.
 */
const GiveQuoteDialog = ({ busy, query, canSend, initialLines, costCurrency, mixedCurrency, onClose, onSubmit }) => {
  const fromRfq = Array.isArray(initialLines) && initialLines.length > 0;

  const [currency, setCurrency] = useState(costCurrency || DEFAULT_CURRENCY);
  const [validityDate, setValidityDate] = useState("");
  const [margin, setMargin] = useState(15);
  const [lines, setLines] = useState(() => {
    if (fromRfq) {
      return initialLines.map((l) => ({
        service: l.service,
        chargeCode: l.chargeCode ?? undefined,
        description: l.description,
        quantity: l.quantity ?? 1,
        // Sell starts empty on purpose — "Apply margin" is a deliberate act, so a
        // quote never goes out at a price nobody chose.
        unitPrice: "",
        cost: l.cost,
        vendorId: l.vendorId,
        vendorName: l.vendorName,
      }));
    }
    return quoteTemplateFor({
      servicePackage: query.servicePackage,
      croHandledBy: query.croHandledBy,
      extraServices: (query.services ?? []).filter(
        (s) => !(PACKAGE_PRESET_SERVICES[query.servicePackage] ?? []).includes(s),
      ),
    });
  });

  const setLine = (i, key, val) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));
  const addLine = () => setLines((p) => [...p, { description: "", quantity: 1, unitPrice: "" }]);
  const removeLine = (i) => setLines((p) => p.filter((_, idx) => idx !== i));

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const costTotal = lines.reduce((s, l) => s + (Number(l.cost) || 0) * (Number(l.quantity) || 0), 0);
  const marginValue = total - costTotal;
  const marginPct = costTotal > 0 ? (marginValue / costTotal) * 100 : null;

  /** Sell = cost + margin%, per unit, rounded to paisa. Only touches costed lines. */
  const applyMargin = () => {
    const m = Number(margin);
    if (!Number.isFinite(m)) return toast.error("Enter a margin percentage");
    setLines((p) =>
      p.map((l) =>
        l.cost == null || l.cost === ""
          ? l
          : { ...l, unitPrice: (Math.round(Number(l.cost) * (1 + m / 100) * 100) / 100).toString() },
      ),
    );
    toast.success(`${m}% margin applied — adjust any line by hand before sending`);
  };

  const build = () => {
    const clean = lines.filter((l) => l.description.trim() && l.unitPrice !== "" && Number(l.unitPrice) >= 0);
    if (!clean.length) {
      toast.error(fromRfq ? "Set a sell price — try Apply margin" : "Add at least one charge line with a price");
      return null;
    }
    return {
      queryId: query.id,
      currency,
      validityDate: validityDate || undefined,
      chargeLines: clean.map((l, i) => ({
        service: l.service,
        // Carried through so resolveCharge() places the charge on the right OTD step.
        chargeCode: l.chargeCode,
        description: l.description.trim(),
        quantity: Number(l.quantity) || 1,
        unitPrice: Number(l.unitPrice),
        // The cost sheet — internal only, and the basis of the job's P&L estimate.
        costAmount: l.cost != null && l.cost !== "" ? Number(l.cost) : undefined,
        costVendorId: l.vendorId ?? undefined,
        sortOrder: i,
      })),
    };
  };

  const submit = (e, alsoSend = false) => {
    e.preventDefault();
    const payload = build();
    if (payload) onSubmit(payload, alsoSend);
  };

  const route = routeOf(query);

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      {/* Body scrolls, footer stays clear of it — a dialog-level scroll leaves the last
          charge line under the sticky footer and past the end of the scroll range. */}
      <DialogContent size="lg" className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>Quote {query.referenceNo}</DialogTitle>
          <DialogDescription>
            {query.customerCompany}
            {route ? ` · ${route}` : ""} —{" "}
            {fromRfq
              ? "priced from the vendors you awarded. Set your margin, then send."
              : "price each service below. Approval by the customer starts the shipment."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-1 min-h-0 flex-col gap-4">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-1 -mx-1 pb-1 scrollbar-thin">
            {/* What the customer asked for */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
              <div className="flex flex-wrap gap-1">
                {query.servicePackage && <Badge className="text-[10px]">{labelForPackage(query.servicePackage)}</Badge>}
                {query.croHandledBy && query.croHandledBy !== "not_applicable" && (
                  <Badge variant="outline" className="text-[10px]">{CRO_HANDLING_SHORT[query.croHandledBy]}</Badge>
                )}
                {query.lcHandledBy && query.lcHandledBy !== "not_applicable" && (
                  <Badge variant="outline" className="text-[10px]">{LC_HANDLING_SHORT[query.lcHandledBy]}</Badge>
                )}
                {(query.services ?? []).map((s) => (
                  <Badge key={s} variant="secondary" className="text-[10px]">{labelForService(s)}</Badge>
                ))}
                {query.isHazardous && <Badge variant="outline" className="text-[10px] text-red-600 border-red-300">Hazardous</Badge>}
                {query.isReefer && <Badge variant="outline" className="text-[10px] text-sky-600 border-sky-300">Reefer</Badge>}
              </div>
              {query.croHandledBy === "customer" && !fromRfq && (
                <p className="text-xs text-muted-foreground">
                  The customer is supplying their own CRO — no CRO charge line is pre-seeded.
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {query.containerTypeCode && <span>Container: <b className="text-foreground">{query.containerTypeCode}</b></span>}
                {query.incoterm && <span>Incoterm: <b className="text-foreground">{query.incoterm}</b></span>}
                {query.weightKg != null && <span>Weight: <b className="text-foreground">{Number(query.weightKg).toLocaleString()} kg</b></span>}
              </div>
              {query.cargoDescription && (
                <p className="text-xs text-muted-foreground">Cargo: {query.cargoDescription}</p>
              )}
            </div>

            {/* Vendor quotes in more than one currency can't be summed into one sell
                price without a human deciding the rate. Say so rather than quietly adding. */}
            {mixedCurrency && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  The awarded vendors quoted in different currencies. Convert the costs to{" "}
                  <b>{currency}</b> yourself before relying on the margin below — it is summing
                  raw numbers, not converting them.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="gq-ccy">Currency</Label>
                <Input id="gq-ccy" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="gq-validity">Valid until (optional)</Label>
                <Input id="gq-validity" type="date" value={validityDate} onChange={(e) => setValidityDate(e.target.value)} />
              </div>
            </div>

            {/* Margin control — only meaningful when there are costs to mark up. */}
            {fromRfq && (
              <div className="rounded-lg border bg-muted/30 p-3 flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="gq-margin">Consort margin</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="gq-margin"
                      type="number"
                      min="0"
                      step="0.5"
                      className="w-24"
                      value={margin}
                      onChange={(e) => setMargin(e.target.value)}
                    />
                    <Percent className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
                <Button type="button" variant="outline" className="gap-1.5 h-9" onClick={applyMargin}>
                  Apply to all lines
                </Button>
                <p className="text-xs text-muted-foreground flex-1 min-w-[12rem]">
                  Sets each sell price to cost + margin. Every line stays editable afterwards.
                </p>
              </div>
            )}

            {/* Charge lines */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Charge lines</Label>
                <Button type="button" size="sm" variant="outline" className="gap-1 h-8" onClick={addLine}>
                  <Plus className="w-3.5 h-3.5" /> Add line
                </Button>
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="space-y-1">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <Input
                        className="col-span-6 min-w-0"
                        placeholder="Description"
                        value={l.description}
                        onChange={(e) => setLine(i, "description", e.target.value)}
                      />
                      <Input
                        className="col-span-2 min-w-0"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Qty"
                        value={l.quantity}
                        onChange={(e) => setLine(i, "quantity", e.target.value)}
                      />
                      <Input
                        className="col-span-3 min-w-0"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Unit price"
                        value={l.unitPrice}
                        onChange={(e) => setLine(i, "unitPrice", e.target.value)}
                      />
                      <button
                        type="button"
                        className="col-span-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                        onClick={() => removeLine(i)}
                        disabled={lines.length === 1}
                        aria-label="Remove charge line"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {/* The buy side of this line, read-only: it is what a vendor committed
                        to, not something to edit while pricing the sale. */}
                    {l.cost != null && l.cost !== "" && (
                      <p className="text-[11px] text-muted-foreground pl-1">
                        Cost {money(l.cost, costCurrency || currency)}
                        {l.vendorName ? ` · ${l.vendorName}` : ""}
                        {Number(l.unitPrice) > 0 && Number(l.cost) > 0 && (
                          <>
                            {" · margin "}
                            <b className={Number(l.unitPrice) >= Number(l.cost) ? "text-emerald-600" : "text-destructive"}>
                              {(((Number(l.unitPrice) - Number(l.cost)) / Number(l.cost)) * 100).toFixed(1)}%
                            </b>
                          </>
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {fromRfq ? (
                <div className="flex flex-wrap justify-end gap-x-5 gap-y-1 text-sm pt-1">
                  <span className="text-muted-foreground">Cost: {money(costTotal, costCurrency || currency)}</span>
                  <span className="font-semibold">Sell: {money(total, currency)}</span>
                  <span className={marginValue >= 0 ? "text-emerald-600 font-semibold" : "text-destructive font-semibold"}>
                    Margin: {money(marginValue, currency)}
                    {marginPct != null ? ` (${marginPct.toFixed(1)}%)` : ""}
                  </span>
                </div>
              ) : (
                <div className="text-right text-sm font-semibold pt-1">Total: {money(total, currency)}</div>
              )}
              {fromRfq && (
                <p className="text-[11px] text-muted-foreground text-right">
                  Cost and vendor are internal — the customer never sees them.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant={canSend ? "outline" : "default"} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Save as draft
            </Button>
            {canSend && (
              <Button type="button" disabled={busy} className="gap-2" onClick={(e) => submit(e, true)}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to customer
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default GiveQuoteDialog;
