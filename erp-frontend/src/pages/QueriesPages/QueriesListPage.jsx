import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FileSearch, RefreshCw, AlertCircle, Plus, Loader2, XCircle, FileText, CheckCircle2, Check, X, Eye, Coins, Pencil, Hand, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useQueryStore } from "@/store/queryStore";
import { useQuotationStore } from "@/store/quotationStore";
// Read-only: DecideQuoteDialog looks up the one live quote for a query. All quotation
// WRITES go through useQuotationStore so they invalidate the screens they affect.
import * as quotationService from "@/services/quotationService";
import { useCustomerStore } from "@/store/customerStore";
import { useAuthStore } from "@/store/authStore";
import { isManagement, rolesOf } from "@/lib/roles";
import { labelForService, QUERY_STATUS_LABELS, QUERY_CHANNEL_LABELS, RAISED_VIA_TO_CHANNEL, QUOTE_SHARE_CHANNEL_LABELS, routeOf, DEFAULT_CURRENCY } from "@/lib/catalog";
import QueryFormModal from "@/components/query/QueryFormModal";
import GiveQuoteDialog from "./GiveQuoteDialog";
import RequestRatesDialog from "@/pages/RfqsPages/RequestRatesDialog";
import { useRfqStore } from "@/store/rfqStore";

const STATUS_STYLES = {
  open: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-300",
  quoted: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300",
  revision_requested: "bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-300",
  shipment_created: "bg-green-50 text-green-700 border-green-400 dark:bg-green-950/30 dark:text-green-300",
  cancelled: "bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300",
  expired: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300",
};

/** Statuses a query can still be quoted from (mirrors quotation.service). */
const QUOTABLE = ["open", "quoted", "revision_requested"];

// Per-channel row badge colours (bdo / bank_lc / website buckets).
const CHANNEL_STYLES = {
  bdo: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-300",
  bank_lc: "bg-violet-50 text-violet-700 border-violet-300 dark:bg-violet-950/30 dark:text-violet-300",
  website: "bg-teal-50 text-teal-700 border-teal-300 dark:bg-teal-950/30 dark:text-teal-300",
};

const money = (n, ccy) =>
  `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;

/**
 * `raisedVia` is a raw enum on the wire; the dialog shows people-readable words.
 * The two keys are the whole `RaisedVia` enum — a storefront request lands as `portal`,
 * since it is owned by the customer's portal account.
 */
const RAISED_VIA_LABELS = {
  bdo: "Sales (phone / visit)",
  portal: "Customer portal / storefront",
};

/**
 * Icon-only row action. Six labelled buttons made the row scroll sideways, so only the
 * one action that is the actual next step keeps its text — everything else is an icon
 * whose label lives in the tooltip (and in `aria-label`, so it is not mouse-only).
 */
const RowAction = ({ title, onClick, disabled, danger, children }) => (
  <Button
    size="sm"
    variant="ghost"
    title={title}
    aria-label={title}
    disabled={disabled}
    onClick={onClick}
    className={`h-8 w-8 p-0 text-muted-foreground ${
      danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:text-foreground"
    }`}
  >
    {children}
  </Button>
);

/**
 * QueriesListPage — shipping requests carrying the SELECTED SERVICES that
 * later compose the shipment's OTD path (CRM_MASTER §5.6/§5.6a, ADR-040/041).
 */
const QueriesListPage = () => {
  const { queries, loading, error, busy, filters, setFilter, fetchQueries, createQuery, updateQuery, cancelQuery, claimQuery } = useQueryStore();
  const { createQuotation, sendQuotation, shareQuotation, approveQuotation, rejectQuotation } = useQuotationStore();
  const createRfqs = useRfqStore((s) => s.createRfqs);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * Mirror the server's approval rules (quotation.controllers approveQuotation) so
   * the Review dialog only offers what the click would actually be allowed to do:
   *  - a pure BDO approves ONLY a query they raised (RULE-QT-03 relaxation);
   *  - every other approver (ASM / Management / Web Manager) is blocked only when
   *    they are the customer's owning BDO (four-eyes, RULE-QT-03).
   * Reject and share have no extra guard beyond permission + scope.
   */
  const bdoOnly = rolesOf(user).includes("bdo") && !rolesOf(user).includes("asm") && !isManagement(user);
  const webManager = rolesOf(user).includes("web_manager");
  const canApproveQuery = (q) => {
    if (!hasPermission("quotation.approve")) return false;
    // web_manager owns the WEBSITE channel: portal-raised quotes are theirs to
    // decide even when they also hold bdo — only four-eyes blocks them.
    if (webManager && q.raisedVia === "portal") return q.assignedBdoId !== user?.id;
    return bdoOnly ? q.raisedById === user?.id : q.assignedBdoId !== user?.id;
  };
  const approveBlockNote = (q) => {
    if (!hasPermission("quotation.approve") || canApproveQuery(q)) return null;
    return bdoOnly && !(webManager && q.raisedVia === "portal")
      ? "Only the BDO who raised this query can approve on the customer's behalf (RULE-QT-03)."
      : "Four-eyes: the owning BDO cannot approve their own customer's quote (RULE-QT-03).";
  };
  const canReject = hasPermission("quotation.reject");
  const canShare = hasPermission("quotation.share");

  // Customers page can deep-link here with a preselected customer.
  const [addOpen, setAddOpen] = useState(!!location.state?.customerId);
  const [editFor, setEditFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [quoteFor, setQuoteFor] = useState(null);
  const [decideFor, setDecideFor] = useState(null);
  const [detailFor, setDetailFor] = useState(null);
  const [ratesFor, setRatesFor] = useState(null);

  const { customers, fetchCustomers } = useCustomerStore();

  useEffect(() => { fetchQueries(); }, [fetchQueries]);
  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // The stores own the refetch and the cross-screen invalidation. Approving here creates
  // a shipment and composes its OTD path (RULE-QT-07), which is why this used to be one of
  // the worst reload traps in the app: the Quotations list still read `sent` and the
  // Shipments list had no new shipment.
  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      setAddOpen(false);
      setEditFor(null);
      setCancelFor(null);
      setQuoteFor(null);
      setDecideFor(null);
      setRatesFor(null);
    } catch (err) {
      toast.error(err?.message || "Couldn't update the query");
    }
  };

  /**
   * Take an unclaimed query out of the shared pool. The server assigns the CUSTOMER to
   * this BDO, so every other query for them leaves the pool in the same click — which is
   * why the toast names the customer, not the query.
   */
  const onClaim = (q) =>
    act(async () => {
      await claimQuery(q.id);
      return { message: `${q.customerCompany} is now yours — ${q.referenceNo} is in your pipeline` };
    });

  /**
   * Quote straight from the query row — Ops doesn't have to re-find the query
   * on the Quotations page. Drafts, then sends in the same click when the user
   * is allowed to send (ops_exec drafts; ops_manager drafts + sends).
   */
  const giveQuote = (payload, alsoSend) =>
    act(async () => {
      const res = await createQuotation(payload);
      if (!alsoSend) return { message: "Quotation drafted — an Ops Manager sends it to the customer" };
      await sendQuotation(res.data.id);
      return { message: `${res.data.referenceNo} sent to the customer` };
    });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><FileSearch className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Queries</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Shipping requests — the selected services drive everything downstream
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={filters.status || "all"} onValueChange={(v) => setFilter("status", v === "all" ? "" : v)} items={[{ value: "all", label: "All statuses" }, ...Object.entries(QUERY_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(QUERY_STATUS_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchQueries} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {hasPermission("query.create") && (
            <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" /> New Query
            </Button>
          )}
        </div>
      </div>

      {/* Channel tabs — the three intake buckets: BDO-raised, bank-LC referrals,
          website (storefront/portal). Server-filtered via ?channel= so scope still
          applies; a web_manager simply sees an empty BDO/Bank LC tab. */}
      <div className="flex items-center gap-1 border-b">
        {[["", "All"], ...Object.entries(QUERY_CHANNEL_LABELS)].map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            onClick={() => setFilter("channel", value)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              (filters.channel || "") === value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium flex-1">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchQueries} className="border-destructive/50 text-destructive hover:bg-destructive/10">Retry</Button>
        </div>
      )}

      {/* Table — four columns, so it no longer needs to scroll sideways on a laptop.
          Widths sit on the headers (not a colgroup, which would reserve a phantom column
          for Services once it hides on mobile): the identity column takes whatever the
          fixed status and action columns leave, instead of reflowing per row. */}
      <div className="border rounded-xl overflow-x-auto bg-white dark:bg-zinc-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left border-b">
            <tr>
              <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">Query</th>
              <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground hidden sm:table-cell w-68">Services</th>
              <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground w-36">Status</th>
              <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground text-right w-px whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && [...Array(4)].map((_, i) => (
              <tr key={i} className="border-t animate-pulse">
                {[...Array(4)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded w-3/4" /></td>)}
              </tr>
            ))}

            {/* Four columns only. Contact, owner, route, dates and the buy-side detail
                all live in the detail dialog now — clicking the row opens it. */}
            {!loading && queries.map((q) => (
              <tr
                key={q.id}
                onClick={() => setDetailFor(q)}
                className="border-t hover:bg-muted/40 transition-colors group cursor-pointer"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-primary">{q.referenceNo}</span>
                    {/* Which intake channel the query came through (BDO / Bank LC / Website). */}
                    {RAISED_VIA_TO_CHANNEL[q.raisedVia] && (
                      <Badge variant="outline" className={`text-[10px] ${CHANNEL_STYLES[RAISED_VIA_TO_CHANNEL[q.raisedVia]] ?? ""}`}>
                        {QUERY_CHANNEL_LABELS[RAISED_VIA_TO_CHANNEL[q.raisedVia]]}
                      </Badge>
                    )}
                    {/* A storefront self-signup arrives unclaimed and stays visible to every
                        BDO until one picks it up (§5.20) — worth a flag on the row itself.
                        The field is internal-only, so a portal customer never sees it. */}
                    {"assignedBdoId" in q && !q.assignedBdoId && (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300">
                        Unassigned
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[30ch] md:max-w-[46ch]">
                    {q.customerCompany}
                    {routeOf(q) && <span className="hidden md:inline"> · {routeOf(q)}</span>}
                  </div>
                </td>

                <td className="px-4 py-3 hidden sm:table-cell align-middle">
                  <div className="flex flex-wrap items-center gap-1 max-w-60">
                    {q.services.slice(0, 2).map((s) => (
                      <Badge key={s} variant="secondary" className="text-[10px] font-normal">{labelForService(s)}</Badge>
                    ))}
                    {q.services.length > 2 && (
                      <span className="text-[10px] text-muted-foreground">+{q.services.length - 2} more</span>
                    )}
                  </div>
                </td>

                <td className="px-4 py-3 align-middle">
                  <Badge variant="outline" className={`text-xs ${STATUS_STYLES[q.status] ?? ""}`}>
                    {QUERY_STATUS_LABELS[q.status]}
                  </Badge>
                  {/* How the buy side is going. Ops reads this before quoting: rates in
                      hand mean a real price, rates outstanding mean a guess. */}
                  {q.rfqSummary && (
                    <button
                      type="button"
                      className="mt-1 block text-[10px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
                      onClick={(e) => { e.stopPropagation(); navigate("/admin/rfqs", { state: { queryId: q.id } }); }}
                      title="Open the rate requests for this query"
                    >
                      {q.rfqSummary.awarded > 0
                        ? `${q.rfqSummary.awarded}/${q.rfqSummary.rfqs} awarded`
                        : `rates ${q.rfqSummary.quotesIn}/${q.rfqSummary.quotesTotal} in`}
                    </button>
                  )}
                </td>

                {/* The row opens the dialog, so these must not bubble. Only the action that
                    IS the next step keeps a label; the rest are icon-only to stay narrow. */}
                <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {"assignedBdoId" in q && !q.assignedBdoId && hasPermission("query.claim") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        className="h-8 px-2.5 text-xs gap-1"
                        onClick={() => onClaim(q)}
                        title="Assign this customer to you and take the query out of the shared pool"
                      >
                        <Hand className="w-3.5 h-3.5" /> Claim
                      </Button>
                    )}
                    {QUOTABLE.includes(q.status) && hasPermission("quotation.create") && (
                      <Button size="sm" className="h-8 px-2.5 text-xs gap-1" onClick={() => setQuoteFor(q)}>
                        <FileText className="w-3.5 h-3.5" />
                        {q.status === "revision_requested" ? "Re-quote" : "Give Quote"}
                      </Button>
                    )}
                    {/* Anyone who can DO something with the sent quote gets Review:
                        approve (role rules above), reject, or give it to the customer. */}
                    {q.status === "quoted" && (canApproveQuery(q) || canReject || canShare) && (
                      <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs gap-1" onClick={() => setDecideFor(q)}>
                        <CheckCircle2 className="w-3.5 h-3.5" /> Review
                      </Button>
                    )}

                    <RowAction title="View full details" onClick={() => setDetailFor(q)}>
                      <Eye className="w-4 h-4" />
                    </RowAction>
                    {/* The buy side comes first: ask vendors, then price the sale. */}
                    {QUOTABLE.includes(q.status) && hasPermission("rfq.manage") && (
                      <RowAction title="Request rates from vendors" onClick={() => setRatesFor(q)}>
                        <Coins className="w-4 h-4" />
                      </RowAction>
                    )}
                    {q.status === "open" && hasPermission("query.update") && (
                      <RowAction title="Edit query" onClick={() => setEditFor(q)}>
                        <Pencil className="w-4 h-4" />
                      </RowAction>
                    )}
                    {["open", "quoted", "revision_requested"].includes(q.status) && hasPermission("query.cancel") && (
                      <RowAction title="Cancel query" danger onClick={() => setCancelFor(q)}>
                        <XCircle className="w-4 h-4" />
                      </RowAction>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {!loading && queries.length === 0 && !error && (
              <tr>
                <td colSpan="4" className="p-10 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FileSearch className="w-8 h-8 opacity-30" />
                    <p className="font-medium">No queries yet</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {addOpen && (
        <QueryFormModal
          mode="create"
          busy={busy}
          customers={customers}
          presetCustomerId={location.state?.customerId}
          onClose={() => { setAddOpen(false); navigate(location.pathname, { replace: true, state: null }); }}
          onSubmit={(payload) => act(() => createQuery(payload), "Query created")}
        />
      )}
      {editFor && (
        <QueryFormModal
          mode="edit"
          busy={busy}
          customers={customers}
          initial={editFor}
          onClose={() => setEditFor(null)}
          onSubmit={(payload) => act(() => updateQuery(editFor.id, payload), "Query updated")}
        />
      )}
      {quoteFor && (
        <GiveQuoteDialog
          busy={busy}
          query={quoteFor}
          canSend={hasPermission("quotation.send")}
          onClose={() => setQuoteFor(null)}
          onSubmit={giveQuote}
        />
      )}
      {decideFor && (
        <DecideQuoteDialog
          busy={busy}
          query={decideFor}
          canApprove={canApproveQuery(decideFor)}
          canReject={canReject}
          approveNote={approveBlockNote(decideFor)}
          canShare={canShare}
          onShare={(quoteId, payload) => shareQuotation(quoteId, payload)}
          onClose={() => setDecideFor(null)}
          onApprove={(quote) =>
            act(
              () => approveQuotation(quote.id, quote.rowVersion),
              `Quote ${quote.referenceNo} approved — the shipment is being created`,
            )
          }
          onReject={(quote, reason) =>
            act(() => rejectQuotation(quote.id, reason), "Quote rejected — Ops can revise it")
          }
        />
      )}
      {cancelFor && (
        <CancelQueryDialog
          busy={busy}
          query={cancelFor}
          onClose={() => setCancelFor(null)}
          onSubmit={(reason) => act(() => cancelQuery(cancelFor.id, reason), "Query cancelled")}
        />
      )}
      {ratesFor && (
        <RequestRatesDialog
          busy={busy}
          query={ratesFor}
          onClose={() => setRatesFor(null)}
          onSubmit={(payload) => act(() => createRfqs(payload))}
        />
      )}
      {detailFor && <QueryDetailDialog query={detailFor} onClose={() => setDetailFor(null)} />}
    </div>
  );
};

/* ── Query detail — everything the table no longer shows ──
      The list is down to four columns, so this dialog is the only place the contact
      block, sales owner, addresses, buy-side progress and timestamps are readable.
      Grouped into sections rather than one flat grid, because it now carries roughly
      twice what it used to. ── */
const DetailSection = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    {children}
  </section>
);

/** Renders the [label, value] pairs that actually have a value; nothing if none do. */
const DetailGrid = ({ rows }) => {
  const present = rows.filter(([, v]) => v);
  if (!present.length) return null;
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
      {present.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[11px] text-muted-foreground">{label}</dt>
          <dd className="text-sm font-medium wrap-break-word">{value}</dd>
        </div>
      ))}
    </dl>
  );
};

const QueryDetailDialog = ({ query: q, onClose }) => {
  // `assignedBdoId` is internal-only (the server withholds it from portal customers),
  // so its absence and a null value mean different things — check for the key itself.
  const owner = "assignedBdoId" in q
    ? q.assignedBdoName ?? "Unassigned — in the shared pool"
    : null;

  const rfq = q.rfqSummary
    ? q.rfqSummary.awarded > 0
      ? `${q.rfqSummary.awarded} of ${q.rfqSummary.rfqs} awarded`
      : `${q.rfqSummary.quotesIn} of ${q.rfqSummary.quotesTotal} rates in`
    : null;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="xl" className="overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {q.referenceNo}
            <Badge variant="outline" className={`text-xs ${STATUS_STYLES[q.status] ?? ""}`}>
              {QUERY_STATUS_LABELS[q.status]}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {q.customerCompany} ({q.customerRef}) · raised by {q.raisedByName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-5 px-1 -mx-1 pb-1 scrollbar-thin">
          <DetailSection title="Services requested">
            <div className="flex flex-wrap gap-1">
              {q.services.map((s) => (
                <Badge key={s} variant="secondary" className="text-[10px] font-normal">{labelForService(s)}</Badge>
              ))}
            </div>
          </DetailSection>

          <DetailSection title="Route">
            <DetailGrid rows={[
              ["Pickup", q.pickupAddress],
              ["Destination", q.destinationAddress],
              ["Lane", routeOf(q)],
            ]} />
          </DetailSection>

          <DetailSection title="Contact">
            <DetailGrid rows={[
              ["Name", q.customerName],
              ["Email", q.customerEmail],
              ["Phone", q.customerPhone],
            ]} />
          </DetailSection>

          <DetailSection title="Ownership & progress">
            <DetailGrid rows={[
              ["Sales owner", owner],
              ["Raised via", RAISED_VIA_LABELS[q.raisedVia] ?? q.raisedVia],
              ["Rate requests", rfq],
              ["Created", fmtDate(q.createdAt)],
              ["Last updated", fmtDate(q.updatedAt)],
              ["Cancelled because", q.cancelReason],
            ]} />
          </DetailSection>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ── Review a sent quote — what each role can DO here is decided by the parent
      (canApprove / canReject / canShare mirror the server's RULE-QT-03 guards):
      approve or reject on the customer's behalf after confirming with them, and/or
      GIVE the quote to the customer (record it went out over email/phone/WhatsApp)
      before they decide. `approveNote` explains a role-blocked approval. ── */
const DecideQuoteDialog = ({ busy, query, canApprove, canReject, approveNote, canShare, onShare, onClose, onApprove, onReject }) => {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("view"); // "view" | "reject"
  const [reason, setReason] = useState("");
  const [shareChannel, setShareChannel] = useState("");
  const [shareNote, setShareNote] = useState("");
  const [sharing, setSharing] = useState(false);

  // Record the give-out without closing the dialog — the BDO often approves
  // right after relaying the quote on the same call.
  const doShare = async () => {
    if (!shareChannel) return toast.error("Pick how you gave the quote to the customer");
    setSharing(true);
    try {
      const res = await onShare(quote.id, { channel: shareChannel, note: shareNote.trim() || undefined });
      setQuote((q) => ({ ...q, ...res.data }));
      setShareChannel("");
      setShareNote("");
      toast.success(res?.message || "Recorded — quote given to the customer");
    } catch (err) {
      toast.error(err?.message || "Couldn't record it");
    } finally {
      setSharing(false);
    }
  };

  useEffect(() => {
    let alive = true;
    quotationService
      .listQuotations({ queryId: query.id, status: "sent" })
      .then((res) => {
        if (!alive) return;
        // Scope may widen the result to all of the user's queries, so pin to THIS
        // query. At most one live quote per query (INV-07); take the latest version.
        const sent = (res.data ?? [])
          .filter((qt) => qt.queryId === query.id)
          .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null;
        setQuote(sent);
      })
      .catch((err) => toast.error(err?.message || "Couldn't load the quote"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [query.id]);

  const route = routeOf(query);
  const expired = quote?.validityDate && new Date(quote.validityDate) < new Date();

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Review quote · {query.referenceNo}</DialogTitle>
          <DialogDescription>
            {query.customerCompany}{route ? ` · ${route}` : ""} —{" "}
            {canApprove || canReject
              ? "confirm the customer's decision, then record it on their behalf."
              : "give the quote to the customer and record how."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !quote ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No sent quote found for this query.</div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-medium text-primary">{quote.referenceNo}</span>
              <span className="text-sm text-muted-foreground">
                {quote.validityDate ? `Valid until ${new Date(quote.validityDate).toLocaleDateString()}` : "No expiry"}
              </span>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="p-2 font-medium text-muted-foreground">Description</th>
                    <th className="p-2 font-medium text-muted-foreground text-right">Qty</th>
                    <th className="p-2 font-medium text-muted-foreground text-right">Unit</th>
                    <th className="p-2 font-medium text-muted-foreground text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(quote.chargeLines ?? []).map((l) => (
                    <tr key={l.id ?? l.sortOrder} className="border-t">
                      <td className="p-2">{l.description}</td>
                      <td className="p-2 text-right">{Number(l.quantity)}</td>
                      <td className="p-2 text-right">{money(l.unitPrice, quote.currency)}</td>
                      <td className="p-2 text-right">{money(l.amount, quote.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-right text-sm font-semibold">Total: {money(quote.totalAmount, quote.currency)}</div>

            {expired && (
              <p className="text-xs text-red-600">This quote has passed its validity date — Ops must revise it before it can be approved.</p>
            )}

            {/* Give the quote to the customer (mail/phone/WhatsApp) and record how.
                Purely informational — the decision buttons below stay independent. */}
            {canShare && mode === "view" && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <Share2 className="w-3.5 h-3.5" /> Give quote to customer
                  </span>
                  {quote.sharedAt && (
                    <span className="text-xs text-muted-foreground">
                      Given via {QUOTE_SHARE_CHANNEL_LABELS[quote.sharedVia] ?? quote.sharedVia} on{" "}
                      {new Date(quote.sharedAt).toLocaleDateString()}
                      {quote.shareNote ? ` — ${quote.shareNote}` : ""}
                    </span>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                  <Select value={shareChannel} onValueChange={setShareChannel}
                    items={Object.entries(QUOTE_SHARE_CHANNEL_LABELS).map(([value, label]) => ({ value, label }))}>
                    <SelectTrigger className="h-9 w-32 shrink-0"><SelectValue placeholder="How?" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(QUOTE_SHARE_CHANNEL_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input className="h-9 flex-1 min-w-32" placeholder="Note (optional)" maxLength={500}
                    value={shareNote} onChange={(e) => setShareNote(e.target.value)} />
                  <Button type="button" variant="outline" className="h-9 gap-1.5 shrink-0"
                    disabled={busy || sharing} onClick={doShare}>
                    {sharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                    {quote.sharedAt ? "Record again" : "Mark as given"}
                  </Button>
                </div>
              </div>
            )}

            {mode === "reject" && (
              <div className="space-y-1.5">
                <Label htmlFor="dq-reason">Rejection reason</Label>
                <Input id="dq-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What did the customer want changed?" autoFocus />
              </div>
            )}

            {/* Why this role sees no Approve button, in the server's words. */}
            {approveNote && mode === "view" && (
              <p className="text-xs text-muted-foreground">{approveNote}</p>
            )}

            <DialogFooter className="gap-2">
              {mode === "view" ? (
                <>
                  <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Close</Button>
                  {canReject && (
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2 text-destructive"
                      disabled={busy}
                      onClick={() => setMode("reject")}
                    >
                      <X className="w-4 h-4" /> Reject
                    </Button>
                  )}
                  {canApprove && (
                    <Button type="button" className="gap-2" disabled={busy || expired} onClick={() => onApprove(quote)}>
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve by customer
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setMode("view")} disabled={busy}>Back</Button>
                  <Button
                    type="button"
                    className="bg-destructive text-white hover:bg-destructive/90 gap-2"
                    disabled={busy}
                    onClick={() => {
                      if (reason.trim().length < 3) return toast.error("A reason is required");
                      onReject(quote, reason.trim());
                    }}
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} Confirm reject
                  </Button>
                </>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const CancelQueryDialog = ({ busy, query, onClose, onSubmit }) => {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel Query {query.referenceNo}</DialogTitle>
          <DialogDescription>Cancellation reasons feed the unserved-demand report.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 3) return toast.error("A reason is required"); onSubmit(reason.trim()); }} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="qcancel-reason">Reason</Label>
            <Input id="qcancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy} className="bg-destructive text-white hover:bg-destructive/90">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cancel Query"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default QueriesListPage;
