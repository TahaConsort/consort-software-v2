import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Coins, RefreshCw, AlertCircle, Loader2, Copy, Check, X, Trophy, Plus, Trash2,
  XCircle, Columns3, FileText, FileDown, Flame, Snowflake,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import toast from "react-hot-toast";
import { useRfqStore } from "@/store/rfqStore";
import { useQuotationStore } from "@/store/quotationStore";
import { useAuthStore } from "@/store/authStore";
import * as rfqService from "@/services/rfqService";
import * as chargeService from "@/services/chargeService";
import * as documentService from "@/services/documentService";
import {
  labelForService, RFQ_STATUS_LABELS, RFQ_STATUS_OPTIONS, VENDOR_QUOTE_STATUS_LABELS,
  VENDOR_TYPE_LABELS, RFQ_LEG_LABELS, DEFAULT_CURRENCY,
} from "@/lib/catalog";
import { rfqMessageFor } from "@/lib/rfqMessage";
import GiveQuoteDialog from "@/pages/QueriesPages/GiveQuoteDialog";

const STATUS_STYLES = {
  open: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-300",
  awarded: "bg-green-50 text-green-700 border-green-400 dark:bg-green-950/30 dark:text-green-300",
  cancelled: "bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300",
};

const QUOTE_STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300",
  quoted: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-300",
  declined: "bg-zinc-100 text-zinc-500 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400",
};

const money = (n, ccy) =>
  `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/**
 * RfqsListPage — the rate-request board.
 *
 * Consort buys every service it sells, so this screen is where a job's cost is
 * actually decided: ask several vendors, put their answers side by side, award one,
 * then carry that cost into the customer quote with a margin on top.
 */
const RfqsListPage = () => {
  const {
    rfqs, loading, error, busy, filters, setFilter, fetchRfqs,
    enterQuote, declineQuote, selectQuote, cancelRfq, addVendors,
  } = useRfqStore();
  const { createQuotation, sendQuotation } = useQuotationStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const location = useLocation();
  const navigate = useNavigate();

  // Only the id is held: the dialog reads its row out of the store below, so a
  // write that refetches the list is reflected without a state-sync effect.
  const [compareId, setCompareId] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [quoteBuilder, setQuoteBuilder] = useState(null);
  const [buildingFor, setBuildingFor] = useState(null);

  const compareFor = compareId ? rfqs.find((r) => r.id === compareId) ?? null : null;

  // The queries list deep-links here for one query's requests.
  useEffect(() => {
    if (location.state?.queryId) setFilter("queryId", location.state.queryId);
  }, [location.state?.queryId, setFilter]);

  useEffect(() => { fetchRfqs(); }, [fetchRfqs]);

  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      return res;
    } catch (err) {
      toast.error(err?.message || "Couldn't update the rate request");
      throw err;
    }
  };

  /**
   * Build the customer quote from what the vendors actually charged. Pulls the
   * awarded lines for the whole query — not just this RFQ — because a customer gets
   * one quote covering every service, however many vendors it took to price it.
   */
  const buildQuote = async (rfq) => {
    setBuildingFor(rfq.id);
    try {
      const res = await rfqService.getCostSheet(rfq.queryId);
      const { groups, mixedCurrency } = res.data ?? {};
      if (!groups?.length) {
        toast.error("Award a vendor first — there is no cost to quote from yet");
        return;
      }
      const initialLines = groups.flatMap((g) =>
        g.lines.map((l) => ({
          service: g.service,
          chargeCode: l.chargeCode ?? undefined,
          description: l.description,
          quantity: Number(l.quantity) || 1,
          cost: Number(l.unitPrice),
          vendorId: g.vendorId,
          vendorName: g.vendorName,
        })),
      );
      setQuoteBuilder({
        query: { ...rfq.query, id: rfq.queryId, referenceNo: rfq.queryRef, customerCompany: rfq.customerCompany },
        initialLines,
        costCurrency: groups[0]?.currency,
        mixedCurrency,
      });
    } catch (err) {
      toast.error(err?.message || "Couldn't load the awarded costs");
    } finally {
      setBuildingFor(null);
    }
  };

  const submitQuote = async (payload, alsoSend) => {
    try {
      const res = await createQuotation(payload);
      if (alsoSend) {
        await sendQuotation(res.data.id);
        toast.success(`${res.data.referenceNo} sent to the customer`);
      } else {
        toast.success("Quotation drafted — an Ops Manager sends it to the customer");
      }
      setQuoteBuilder(null);
      setCompareId(null);
    } catch (err) {
      toast.error(err?.message || "Couldn't create the quotation");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><Coins className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Rate Requests</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Ask vendors, compare what comes back, award the job — then quote the customer
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {filters.queryId && (
            <Button
              size="sm"
              variant="ghost"
              className="h-9 gap-1.5 text-xs"
              onClick={() => { setFilter("queryId", ""); navigate(location.pathname, { replace: true, state: null }); }}
            >
              <X className="w-3.5 h-3.5" /> Clear query filter
            </Button>
          )}
          <Select value={filters.status || "all"} onValueChange={(v) => setFilter("status", v === "all" ? "" : v)}>
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {RFQ_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={fetchRfqs} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Board */}
      <div className="rounded-xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr className="[&>th]:p-3 [&>th]:font-medium [&>th]:text-muted-foreground">
              <th>Request</th>
              <th>Query / Customer</th>
              <th>Service</th>
              <th className="hidden md:table-cell">Rates in</th>
              <th className="hidden lg:table-cell">Best rate</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && (
              <tr><td colSpan="7" className="p-10 text-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              </td></tr>
            )}

            {!loading && rfqs.map((r) => (
              <tr key={r.id} className="group hover:bg-muted/30">
                <td className="p-3">
                  <span className="font-medium text-primary">{r.referenceNo}</span>
                  <span className="ml-1.5 inline-flex gap-1 align-middle">
                    {r.query?.isHazardous && <Flame className="w-3.5 h-3.5 text-red-500" title="Hazardous" />}
                    {r.query?.isReefer && <Snowflake className="w-3.5 h-3.5 text-sky-500" title="Reefer" />}
                  </span>
                </td>
                <td className="p-3">
                  <span className="font-medium">{r.customerCompany}</span>{" "}
                  <span className="text-xs text-muted-foreground">({r.queryRef})</span>
                </td>
                <td className="p-3">
                  <Badge variant="secondary" className="text-[10px]">{labelForService(r.service)}</Badge>
                  {r.leg && (
                    <Badge variant="outline" className="text-[10px] ml-1">{RFQ_LEG_LABELS[r.leg]}</Badge>
                  )}
                </td>
                <td className="p-3 hidden md:table-cell">
                  <span className={r.quotesIn === 0 ? "text-muted-foreground" : "font-medium"}>
                    {r.quotesIn}/{r.quotesTotal}
                  </span>
                </td>
                <td className="p-3 hidden lg:table-cell text-muted-foreground">
                  {r.bestTotal == null ? "—" : money(r.bestTotal, r.quotes?.find((q) => q.status === "quoted")?.currency)}
                  {r.mixedCurrency && <span className="ml-1 text-[10px] text-amber-600">mixed ccy</span>}
                </td>
                <td className="p-3">
                  <Badge variant="outline" className={`text-xs ${STATUS_STYLES[r.status] ?? ""}`}>
                    {RFQ_STATUS_LABELS[r.status]}
                  </Badge>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    className="h-8 px-2.5 text-xs gap-1"
                    onClick={() => setCompareId(r.id)}
                  >
                    <Columns3 className="w-3.5 h-3.5" /> Compare
                  </Button>
                  {r.status === "awarded" && hasPermission("quotation.create") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 text-xs gap-1 ml-1"
                      disabled={buildingFor === r.id}
                      onClick={() => buildQuote(r)}
                    >
                      {buildingFor === r.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <FileText className="w-3.5 h-3.5" />} Build Quote
                    </Button>
                  )}
                  {r.status === "open" && hasPermission("rfq.manage") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-xs gap-1 ml-1 opacity-70 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setCancelFor(r)}
                    >
                      <XCircle className="w-3.5 h-3.5" /> Cancel
                    </Button>
                  )}
                </td>
              </tr>
            ))}

            {!loading && rfqs.length === 0 && !error && (
              <tr>
                <td colSpan="7" className="p-10 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Coins className="w-8 h-8 opacity-30" />
                    <p className="font-medium">No rate requests yet</p>
                    <p className="text-xs">
                      Open a query and choose <b>Request Rates</b> to ask vendors for a price.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {compareFor && (
        <RfqComparisonDialog
          rfq={compareFor}
          busy={busy}
          canAward={hasPermission("rfq.award")}
          canManage={hasPermission("rfq.manage")}
          canQuote={hasPermission("quotation.create")}
          onClose={() => setCompareId(null)}
          onEnterQuote={(quoteId, payload) => act(() => enterQuote(compareFor.id, quoteId, payload))}
          onDecline={(quoteId) => act(() => declineQuote(compareFor.id, quoteId))}
          onSelect={(quoteId) => act(() => selectQuote(compareFor.id, quoteId))}
          onAddVendors={(ids) => act(() => addVendors(compareFor.id, ids))}
          onBuildQuote={() => buildQuote(compareFor)}
          building={buildingFor === compareFor.id}
        />
      )}

      {cancelFor && (
        <CancelRfqDialog
          rfq={cancelFor}
          busy={busy}
          onClose={() => setCancelFor(null)}
          onSubmit={async (reason) => {
            await act(() => cancelRfq(cancelFor.id, reason));
            setCancelFor(null);
          }}
        />
      )}

      {quoteBuilder && (
        <GiveQuoteDialog
          busy={busy}
          query={quoteBuilder.query}
          initialLines={quoteBuilder.initialLines}
          costCurrency={quoteBuilder.costCurrency}
          mixedCurrency={quoteBuilder.mixedCurrency}
          canSend={hasPermission("quotation.send")}
          onClose={() => setQuoteBuilder(null)}
          onSubmit={submitQuote}
        />
      )}
    </div>
  );
};

/* ── Compare what the vendors came back with, side by side, and award one. ── */
const RfqComparisonDialog = ({
  rfq, busy, canAward, canManage, canQuote, onClose,
  onEnterQuote, onDecline, onSelect, onBuildQuote, building,
}) => {
  const [entryFor, setEntryFor] = useState(null);
  const [copied, setCopied] = useState(null);
  const [rcBusy, setRcBusy] = useState(null);

  /** Generate the awarded vendor's Rate Confirmation and download it immediately. */
  const generateRc = async (q) => {
    setRcBusy(q.id);
    try {
      const res = await rfqService.generateVendorRc(rfq.id, q.id);
      await documentService.downloadDocument(res.data.documentId, res.data.fileName);
      toast.success(`Rate confirmation ready — WhatsApp it to ${q.vendor.name}`);
    } catch (err) {
      toast.error(err?.message || "Couldn't generate the rate confirmation");
    } finally {
      setRcBusy(null);
    }
  };

  const quotes = rfq.quotes ?? [];
  const quoted = quotes.filter((q) => q.status === "quoted");
  const cheapest = quoted.length ? Math.min(...quoted.map((q) => Number(q.totalAmount))) : null;

  const copyMessage = async (quote) => {
    try {
      await navigator.clipboard.writeText(
        rfqMessageFor({ rfq, query: rfq.query, vendor: quote.vendor }),
      );
      setCopied(quote.id);
      toast.success(`Rate request copied — paste it to ${quote.vendor.name}`);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("Couldn't copy — select the text manually");
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
        <DialogContent size="full" className="overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {rfq.referenceNo}
              <Badge variant="secondary" className="text-[10px]">{labelForService(rfq.service)}</Badge>
              {rfq.leg && <Badge variant="outline" className="text-[10px]">{RFQ_LEG_LABELS[rfq.leg]}</Badge>}
              <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[rfq.status] ?? ""}`}>
                {RFQ_STATUS_LABELS[rfq.status]}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {rfq.customerCompany} · {rfq.queryRef}
              {rfq.neededBy ? ` — rates needed by ${new Date(rfq.neededBy).toLocaleDateString()}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-auto px-1 -mx-1 scrollbar-thin">
            {quotes.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No vendors on this request.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-popover p-2 text-left font-medium text-muted-foreground border-b w-48">
                        Vendor
                      </th>
                      {quotes.map((q) => (
                        <th key={q.id} className="p-2 text-left border-b min-w-52 align-top">
                          <div className="space-y-1">
                            <div className="font-medium flex items-center gap-1.5">
                              {q.vendor.name}
                              {q.isSelected && <Trophy className="w-3.5 h-3.5 text-amber-500" title="Awarded" />}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-normal">
                              {VENDOR_TYPE_LABELS[q.vendor.type]}
                              {q.vendor.phone ? ` · ${q.vendor.phone}` : ""}
                            </div>
                            <Badge variant="outline" className={`text-[10px] ${QUOTE_STATUS_STYLES[q.status] ?? ""}`}>
                              {VENDOR_QUOTE_STATUS_LABELS[q.status]}
                            </Badge>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Charge lines, aligned by position: vendors rarely break a price
                        down the same way, so this compares totals honestly and details
                        loosely rather than pretending the rows match. */}
                    <tr>
                      <td className="sticky left-0 z-10 bg-popover p-2 align-top text-muted-foreground border-b">
                        Charges
                      </td>
                      {quotes.map((q) => (
                        <td key={q.id} className="p-2 align-top border-b">
                          {q.status !== "quoted" ? (
                            <span className="text-xs text-muted-foreground">
                              {q.status === "declined" ? "Passed on this job" : "Waiting for their rate"}
                            </span>
                          ) : (
                            <ul className="space-y-1">
                              {q.lines.map((l) => (
                                <li key={l.id} className="text-xs">
                                  <span className="text-muted-foreground">{l.description}</span>
                                  {Number(l.quantity) !== 1 && (
                                    <span className="text-muted-foreground"> ×{Number(l.quantity)}</span>
                                  )}
                                  <br />
                                  <span className="font-medium">{money(l.amount, q.currency)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr className="bg-muted/40">
                      <td className="sticky left-0 z-10 bg-muted/40 p-2 font-medium border-b">Total</td>
                      {quotes.map((q) => {
                        const isBest = q.status === "quoted" && Number(q.totalAmount) === cheapest;
                        return (
                          <td key={q.id} className="p-2 border-b">
                            {q.status === "quoted" ? (
                              <span className={`font-semibold ${isBest ? "text-emerald-600" : ""}`}>
                                {money(q.totalAmount, q.currency)}
                                {isBest && <span className="ml-1 text-[10px] font-normal">lowest</span>}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {q.validityDate && (
                              <div className="text-[10px] text-muted-foreground">
                                valid to {new Date(q.validityDate).toLocaleDateString()}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {quotes.some((q) => q.notes) && (
                      <tr>
                        <td className="sticky left-0 z-10 bg-popover p-2 align-top text-muted-foreground border-b">
                          Notes
                        </td>
                        {quotes.map((q) => (
                          <td key={q.id} className="p-2 align-top border-b text-xs text-muted-foreground">
                            {q.notes || "—"}
                          </td>
                        ))}
                      </tr>
                    )}
                    <tr>
                      <td className="sticky left-0 z-10 bg-popover p-2 align-top text-muted-foreground" />
                      {quotes.map((q) => (
                        <td key={q.id} className="p-2 align-top">
                          <div className="flex flex-col gap-1.5 items-start">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => copyMessage(q)}
                            >
                              {copied === q.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              Copy request
                            </Button>
                            {canManage && rfq.status !== "cancelled" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => setEntryFor(q)}
                              >
                                <Plus className="w-3 h-3" />
                                {q.status === "quoted" ? "Edit rate" : "Enter rate"}
                              </Button>
                            )}
                            {canAward && q.status === "quoted" && !q.isSelected && rfq.status !== "cancelled" && (
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs gap-1"
                                disabled={busy}
                                onClick={() => onSelect(q.id)}
                              >
                                <Trophy className="w-3 h-3" /> Award
                              </Button>
                            )}
                            {/* The buy-side Rate Confirmation — only a won rate is a
                                contract worth papering. Saved to the vendor's documents
                                and downloaded so ops can WhatsApp it. */}
                            {canManage && q.isSelected && rfq.status === "awarded" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1"
                                disabled={rcBusy === q.id}
                                onClick={() => generateRc(q)}
                              >
                                {rcBusy === q.id
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <FileDown className="w-3 h-3" />} Vendor RC
                              </Button>
                            )}
                            {canManage && q.status !== "declined" && !q.isSelected && rfq.status !== "cancelled" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive"
                                disabled={busy}
                                onClick={() => onDecline(q.id)}
                              >
                                <X className="w-3 h-3" /> Declined
                              </Button>
                            )}
                          </div>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Close</Button>
            {rfq.status === "awarded" && canQuote && (
              <Button className="gap-2" disabled={busy || building} onClick={onBuildQuote}>
                {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                Build customer quote
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {entryFor && (
        <EnterQuoteDialog
          quote={entryFor}
          service={rfq.service}
          busy={busy}
          onClose={() => setEntryFor(null)}
          onSubmit={async (payload) => {
            await onEnterQuote(entryFor.id, payload);
            setEntryFor(null);
          }}
        />
      )}
    </>
  );
};

/* ── Type in what a vendor quoted over the phone. ── */
const EnterQuoteDialog = ({ quote, service, busy, onClose, onSubmit }) => {
  const [chargeTypes, setChargeTypes] = useState([]);
  const [currency, setCurrency] = useState(quote.currency || DEFAULT_CURRENCY);
  const [validityDate, setValidityDate] = useState(
    quote.validityDate ? new Date(quote.validityDate).toISOString().slice(0, 10) : "",
  );
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [lines, setLines] = useState(() =>
    quote.lines?.length
      ? quote.lines.map((l) => ({
          chargeCode: l.chargeCode ?? "",
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: String(l.unitPrice),
        }))
      : [{ chargeCode: "", description: "", quantity: 1, unitPrice: "" }],
  );

  useEffect(() => {
    chargeService
      .listChargeTypes()
      .then((res) => setChargeTypes(res.data ?? []))
      .catch(() => {}); // the charge code is optional — a failed catalog must not block entry
  }, []);

  const setLine = (i, key, val) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));
  const addLine = () => setLines((p) => [...p, { chargeCode: "", description: "", quantity: 1, unitPrice: "" }]);
  const removeLine = (i) => setLines((p) => p.filter((_, idx) => idx !== i));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);

  // Charges for this service first — that is what this vendor was asked about.
  const relevant = chargeTypes.filter((c) => c.service === service);
  const others = chargeTypes.filter((c) => c.service !== service);

  const submit = (e) => {
    e.preventDefault();
    const clean = lines.filter((l) => l.description.trim() && l.unitPrice !== "" && Number(l.unitPrice) >= 0);
    if (!clean.length) return toast.error("Add at least one charge line with a rate");
    onSubmit({
      currency,
      validityDate: validityDate || undefined,
      notes: notes.trim() || undefined,
      lines: clean.map((l, i) => ({
        chargeCode: l.chargeCode || undefined,
        description: l.description.trim(),
        quantity: Number(l.quantity) || 1,
        unitPrice: Number(l.unitPrice),
        sortOrder: i,
      })),
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg" className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>{quote.vendor.name}'s rate</DialogTitle>
          <DialogDescription>
            {labelForService(service)} — enter what they quoted. Totals are recomputed
            server-side.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-1 min-h-0 flex-col gap-4">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-1 -mx-1 pb-1 scrollbar-thin">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="eq-ccy">Currency</Label>
                <Input
                  id="eq-ccy"
                  value={currency}
                  maxLength={3}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="eq-validity">Rate valid until (optional)</Label>
                <Input
                  id="eq-validity"
                  type="date"
                  value={validityDate}
                  onChange={(e) => setValidityDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Charges quoted</Label>
                <Button type="button" size="sm" variant="outline" className="gap-1 h-8" onClick={addLine}>
                  <Plus className="w-3.5 h-3.5" /> Add line
                </Button>
              </div>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3 min-w-0">
                    <Select
                      value={l.chargeCode || "none"}
                      onValueChange={(v) => setLine(i, "chargeCode", v === "none" ? "" : v)}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="Type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Uncategorised</SelectItem>
                        {relevant.map((c) => (
                          <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                        ))}
                        {others.map((c) => (
                          <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    className="col-span-4 min-w-0"
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
                    className="col-span-2 min-w-0"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Rate"
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
              ))}
              <div className="text-right text-sm font-semibold pt-1">Total: {money(total, currency)}</div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="eq-notes">Notes (optional)</Label>
              <Input
                id="eq-notes"
                placeholder="e.g. rate excludes detention beyond 5 days"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save rate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ── Cancel an open request. ── */
const CancelRfqDialog = ({ rfq, busy, onClose, onSubmit }) => {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {rfq.referenceNo}?</DialogTitle>
          <DialogDescription>
            The vendor replies already captured stay on the record. You can raise a fresh
            request for {labelForService(rfq.service)} afterwards.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit(reason.trim() || undefined); }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="cr-reason">Reason (optional)</Label>
            <Input
              id="cr-reason"
              placeholder="e.g. customer put the shipment on hold"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Keep it open</Button>
            <Button type="submit" variant="destructive" disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Cancel request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RfqsListPage;
