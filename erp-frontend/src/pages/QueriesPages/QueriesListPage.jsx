import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FileSearch,
  Coins,
  RefreshCw,
  Plus,
  Loader2,
  XCircle,
  FileText,
  CheckCircle2,
  Eye,
  Pencil,
  Hand,
  FileSignature,
  ShieldCheck,
  MapPin,
  ArrowRight,
  Mail,
  Phone,
  User,
  Clock,
} from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  EmptyState,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  Skeleton,
  TBody,
  TD,
  TH,
  THead,
  TRow,
  Table,
  ToggleGroup,
  Tooltip,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import { useQueryStore } from "@/store/queryStore";
import { useQuotationStore } from "@/store/quotationStore";
import { useCustomerStore } from "@/store/customerStore";
import * as documentService from "@/services/documentService";
import { useAuthStore } from "@/store/authStore";
import {
  labelForService,
  QUERY_STATUS_LABELS,
  QUERY_CHANNEL_LABELS,
  RAISED_VIA_TO_CHANNEL,
  APPROVAL_CHANNEL_LABELS,
  labelForMode,
  labelForScope,
  routeOf,
} from "@/lib/catalog";
import QueryFormModal from "@/components/query/QueryFormModal";
import GiveQuoteDialog from "./GiveQuoteDialog";
import DecideQuoteDialog from "./DecideQuoteDialog";
import RequestRatesDialog from "./RequestRatesDialog";

/**
 * Row colours come from the semantic tokens (@neuctra/ui theme contract) rather than a
 * raw palette, so the whole table follows the consumer's light/dark theme with no
 * `dark:` variants. Badge's own `soft` variant paints `bg-primary/10 text-primary`; these
 * classes are merged in last (the component runs them through tailwind-merge), so they
 * win cleanly.
 *
 * Every badge on the row shares one recipe — `/10` fill, `/30` hairline border, nowrap —
 * so the column reads as a single family instead of six competing colour blocks. There
 * are six statuses and four status tokens, so `revision_requested` shares the warning
 * ramp with `quoted` and separates itself with a dashed border rather than a new hue.
 */
const CHIP = "whitespace-nowrap border text-xs";

const STATUS_STYLES = {
  open: "border-info/30 bg-info/10 text-info",
  quoted: "border-warning/30 bg-warning/10 text-warning",
  revision_requested:
    "border-dashed border-warning/50 bg-warning/10 text-warning",
  shipment_created: "border-success/30 bg-success/10 text-success",
  cancelled: "border-border bg-muted text-muted-foreground",
  expired: "border-destructive/30 bg-destructive/10 text-destructive",
};

/** Statuses a query can still be quoted from (mirrors quotation.service). */
const QUOTABLE = ["open", "quoted", "revision_requested"];

/**
 * Statuses that still WANT a quote from Ops, which is a narrower question than what the
 * server will accept. `quoted` is deliberately absent: the query only reaches it when a
 * quotation is actually sent to the customer (a draft leaves it `open`), so from that
 * point the quote has been given and the row's next step is Review, not another quote.
 * `revision_requested` stays, because that IS the customer asking for a new price.
 */
const NEEDS_QUOTE = ["open", "revision_requested"];

// Per-channel row badge colours (bdo / bank_lc / website buckets). Quieter than the
// status chips — the channel is context, not the thing Ops is scanning for.
const CHANNEL_STYLES = {
  bdo: "border-info/30 bg-info/10 text-info",
  bank_lc: "border-primary/30 bg-primary/10 text-primary",
  website: "border-border bg-muted text-muted-foreground",
};

/** Neutral chip for services and other non-status facts. */
const NEUTRAL_CHIP = "border-border bg-muted text-muted-foreground";

/**
 * `xs` sets the 12px label that matches the table's own text; `h-9` then overrides the
 * size preset's `min-h-[28px]` so every control on the row is still 36px tall and lines
 * up with the toolbar above the table. Size and height are separate knobs here on
 * purpose — Button merges className through tailwind-merge, so `h-9` wins cleanly.
 */
const ACTION_BTN = "h-9 px-3";
const ACTION_ICON_BTN = "h-9 w-9 shrink-0 p-0";

/**
 * Table rhythm. TH/TD merge their className with plain clsx (not tailwind-merge) and
 * hardcode `px-5 py-3` / `px-3 py-2`, so a padding utility passed from here is a
 * coin-flip on stylesheet order — `style` is the only deterministic route.
 *
 * Note this is unrelated to the `dense` prop on <Table>, which only sets the table's
 * base font size: Table forwards `dense` to THead/TBody, but neither forwards it on to
 * the rows, so it never reaches a cell's padding. That split is what lets the type be
 * small and the rows roomy at the same time.
 */
const HEAD_CELL = { padding: "1rem 1.5rem" };
const CELL = { padding: "1.25rem 1.5rem" };

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

/**
 * Where the customer's acceptance stands (ADR-056), from the row's `acceptance` block.
 * Amber while Consort is waiting on the customer, green once one of the customer's own
 * acts approved it. Null when there is nothing to say.
 *
 * `text` is deliberately one or two words. The long form ("Customer-approved · Bank
 * portal", "Awaiting confirmation") was wider than the status column, so every chip
 * wrapped to two lines and pushed the row heights apart. The full sentence lives in
 * `title`, which the row renders as a tooltip.
 */
const acceptanceChip = (a) => {
  if (!a) return null;
  if (a.quotationStatus === "approved") {
    const via =
      APPROVAL_CHANNEL_LABELS[a.approvalChannel] ??
      a.approvalChannel ??
      "customer";
    return {
      tone: "border-success/30 bg-success/10 text-success",
      text: "Approved",
      title: `Customer-approved via ${via}${a.link?.approverName ? ` · ${a.link.approverName}` : ""}`,
    };
  }
  if (a.evidence?.verificationStatus === "unverified") {
    return {
      tone: "border-warning/30 bg-warning/10 text-warning",
      text: "To verify",
      title:
        "The customer's signed quotation is uploaded — Ops verifies it to create the shipment",
    };
  }
  if (a.evidence?.verificationStatus === "rejected") {
    return {
      tone: "border-destructive/30 bg-destructive/10 text-destructive",
      text: "Copy rejected",
      title:
        a.evidence.verificationNote ??
        "The customer's signed copy was rejected",
    };
  }
  if (a.claimedAt) {
    const lapsed = a.link && a.link.status !== "open";
    return {
      tone: lapsed
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-warning/30 bg-warning/10 text-warning",
      text: lapsed ? "Lapsed" : "Confirming",
      title: `${a.claimedByName ?? "Sales"} recorded the customer's yes via ${a.claimedVia ?? "—"} on ${fmtDate(a.claimedAt)}${
        a.link?.expiresAt
          ? ` · link ${a.link.status === "open" ? "expires" : a.link.status} ${fmtDate(a.link.expiresAt)}`
          : ""
      }`,
    };
  }
  if (a.link?.status === "open") {
    return {
      tone: "border-info/30 bg-info/10 text-info",
      text: "Link sent",
      title: `The customer's approval link expires ${fmtDate(a.link.expiresAt)}`,
    };
  }
  return null;
};

/**
 * `raisedVia` is a raw enum on the wire; the dialog shows people-readable words.
 * The two keys are the whole `RaisedVia` enum — a storefront request lands as `portal`,
 * since it is owned by the customer's portal account.
 */
const RAISED_VIA_LABELS = {
  bdo: "Sales (phone / visit)",
  portal: "Customer portal / storefront",
};

/** `""` is the "All" bucket — ToggleGroup's single mode also deselects to `""`, which
    lands on the same filter, so re-clicking the active channel simply widens to All. */
const CHANNEL_OPTIONS = [
  { value: "", label: "All" },
  ...Object.entries(QUERY_CHANNEL_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...Object.entries(QUERY_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

/**
 * Icon-only row action. Six labelled buttons made the row scroll sideways, so only the
 * one action that is the actual next step keeps its text — everything else is an icon
 * whose label lives in the tooltip (and in `aria-label`, so it is not mouse-only).
 */
const RowAction = ({ title, onClick, disabled, danger, children }) => (
  <Button
    size="xs"
    variant="ghost"
    aria-label={title}
    disabled={disabled}
    onClick={onClick}
    className={`${ACTION_ICON_BTN} text-muted-foreground ${
      danger
        ? "hover:bg-destructive/10 hover:text-destructive"
        : "hover:text-foreground"
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
  const {
    queries,
    loading,
    error,
    busy,
    filters,
    setFilter,
    fetchQueries,
    createQuery,
    updateQuery,
    cancelQuery,
    claimQuery,
  } = useQueryStore();
  const { createQuotation, sendQuotation, shareQuotation, rejectQuotation } =
    useQuotationStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * Nobody internal approves a quote any more (ADR-056) — a shipment is born only from
   * the customer's own act. What the Review dialog offers is decided by three plain
   * permissions: sales records the yes and relays the link (`quotation.share`), Ops
   * verifies the customer's signed copy (`document.verify`), and either may reject on
   * the customer's behalf (`quotation.reject`).
   */
  const canReject = hasPermission("quotation.reject");
  const canShare = hasPermission("quotation.share");
  const canVerify = hasPermission("document.verify");

  // Customers page can deep-link here with a preselected customer.
  const [addOpen, setAddOpen] = useState(!!location.state?.customerId);
  const [editFor, setEditFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [quoteFor, setQuoteFor] = useState(null);
  const [decideFor, setDecideFor] = useState(null);
  const [ratesFor, setRatesFor] = useState(null);
  const [detailFor, setDetailFor] = useState(null);
  // Query id whose Rate Confirmation is being fetched, so one row spins rather than all.
  const [rcDownloading, setRcDownloading] = useState(null);

  /**
   * The Rate Confirmation generated when the quote was approved (ADR-055). Ops signs it
   * out to the customer from here rather than opening the shipment to find it.
   * The download itself is streamed and audited server-side.
   */
  const downloadRc = async (q) => {
    if (rcDownloading) return;
    setRcDownloading(q.id);
    try {
      await documentService.downloadDocument(
        q.rateConfirmation.documentId,
        q.rateConfirmation.fileName,
      );
    } catch (err) {
      toast.error(err?.message || "Couldn't download the Rate Confirmation");
    } finally {
      setRcDownloading(null);
    }
  };

  const { customers, fetchCustomers } = useCustomerStore();

  useEffect(() => {
    fetchQueries();
  }, [fetchQueries]);
  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

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
      return {
        message: `${q.customerCompany} is now yours — ${q.referenceNo} is in your pipeline`,
      };
    });

  /**
   * Quote straight from the query row — Ops doesn't have to re-find the query
   * on the Quotations page. Drafts, then sends in the same click when the user
   * is allowed to send (every ops role can, since the single ops permission set).
   */
  const giveQuote = (payload, alsoSend) =>
    act(async () => {
      const res = await createQuotation(payload);
      if (!alsoSend)
        return { message: "Quotation drafted — send it when it is ready" };
      await sendQuotation(res.data.id);
      return { message: `${res.data.referenceNo} sent to the customer` };
    });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <FileSearch className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Queries
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Shipping requests
            </p>
          </div>
        </div>

        {/* Select's `sm` has no fixed height (px-2.5 py-1.5 lands near 30px) while
            Button's `sm` is min-h-[32px], so the toolbar sat on two different baselines.
            Everything here is pinned to h-9 instead — `h-9` and `min-h-[32px]` are
            different properties, so no class has to out-merge another. */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={fetchQueries}
            disabled={loading}
            iconBefore={
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            }
          >
            Refresh
          </Button>
          <Select
            size="md"
            value={filters.status || "all"}
            onValueChange={(v) => setFilter("status", v === "all" ? "" : v)}
            options={STATUS_OPTIONS}
            placeholder="Status"
            showCheckIcon={false}
            className="w-44!"
            containerClassName="w-44"
            triggerClassName="h-9"
          />

          {hasPermission("query.create") && (
            <Button
              size="sm"
              className="h-9"
              onClick={() => setAddOpen(true)}
              iconBefore={<Plus className="h-4 w-4" />}
            >
              New Query
            </Button>
          )}
        </div>
      </div>

      {/* Channel filter — the three intake buckets: BDO-raised, bank-LC referrals,
          website (storefront/portal). Server-filtered via ?channel= so scope still
          applies; a web_manager simply sees an empty BDO/Bank LC tab. */}
      <ToggleGroup
        size="md"
        options={CHANNEL_OPTIONS}
        value={filters.channel || ""}
        onChange={(v) => setFilter("channel", v)}
      />

      {/* Error */}
      {error && (
        <Callout type="error" title="Couldn't load the queries">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={fetchQueries}>
              Retry
            </Button>
          </div>
        </Callout>
      )}

      {/* Table — four columns, so it no longer needs to scroll sideways on a laptop.
          EmptyState brings its own padding and icon sizing, so the Card only supplies
          the surface. The empty case replaces the table rather than living inside it —
          TD carries no `colSpan`, so a spanning "nothing here" row is not expressible. */}
      {!loading && queries.length === 0 && !error ? (
        <Card padding="none">
          <EmptyState
            size="lg"
            icon={<FileSearch />}
            title="No queries yet"
            description="Shipping requests you raise or receive will show up here."
            action={
              hasPermission("query.create") ? (
                <Button
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  iconBefore={<Plus className="h-4 w-4" />}
                >
                  New Query
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        /* Table renders its own surface — `w-full rounded-2xl border border-border
           bg-background shadow-sm`, plus overflow-x-auto from `responsive`. Wrapping it
           in a Card put a second border inside it at a smaller radius, so the table is
           left to be its own card. `bordered` is what draws the row separators. */
        <div className="w-full min-w-0">
          <div className="w-full overflow-x-auto">
            <Table className="w-full min-w-0 table-fixed" bordered dense>
              {/* HEADER */}
              <THead>
                <TRow>
                  <TH
                    style={{
                      ...HEAD_CELL,
                      width: "32%",
                    }}
                  >
                    Query
                  </TH>

                  <TH
                    className="hidden sm:table-cell"
                    style={{
                      ...HEAD_CELL,
                      width: "23%",
                    }}
                  >
                    Services
                  </TH>

                  <TH
                    style={{
                      ...HEAD_CELL,
                      width: "20%",
                    }}
                  >
                    Status
                  </TH>

                  <TH
                    style={{
                      ...HEAD_CELL,
                      width: "25%",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Actions
                  </TH>
                </TRow>
              </THead>

              <TBody>
                {/* LOADING */}
                {loading &&
                  [...Array(4)].map((_, i) => (
                    <TRow key={i}>
                      {[...Array(4)].map((_, j) => (
                        <TD
                          key={j}
                          style={{
                            ...CELL,
                            minWidth: 0,
                            maxWidth: 0,
                          }}
                        >
                          <Skeleton width="70%" height={16} />
                        </TD>
                      ))}
                    </TRow>
                  ))}

                {/* DATA */}
                {!loading &&
                  queries.map((q) => (
                    <TRow
                      key={q.id}
                      className="bg-card!"
                      onClick={() => setDetailFor(q)}
                    >
                      {/* ================= QUERY ================= */}
                      <TD
                        style={{
                          ...CELL,
                          minWidth: 0,
                          maxWidth: 0,
                          overflow: "hidden",
                        }}
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="shrink-0 text-sm font-semibold text-primary">
                              {q.referenceNo}
                            </span>

                            {/* Raised via channel */}
                            {RAISED_VIA_TO_CHANNEL[q.raisedVia] && (
                              <Badge
                                variant="soft"
                                size="sm"
                                text={
                                  QUERY_CHANNEL_LABELS[
                                    RAISED_VIA_TO_CHANNEL[q.raisedVia]
                                  ]
                                }
                                className={`${CHIP} ${
                                  CHANNEL_STYLES[
                                    RAISED_VIA_TO_CHANNEL[q.raisedVia]
                                  ] ?? ""
                                }`}
                              />
                            )}

                            {/* Unassigned */}
                            {"assignedBdoId" in q && !q.assignedBdoId && (
                              <Badge
                                variant="soft"
                                size="sm"
                                text="Unassigned"
                                className={`${CHIP} border-warning/30 bg-warning/10 text-warning`}
                              />
                            )}
                          </div>

                          <div className="mt-1.5 min-w-0 truncate text-muted-foreground">
                            {q.customerCompany}

                            {routeOf(q) && (
                              <span className="hidden md:inline">
                                {" "}
                                · {routeOf(q)}
                              </span>
                            )}
                          </div>
                        </div>
                      </TD>

                      {/* ================= SERVICES ================= */}
                      <TD
                        className="hidden sm:table-cell"
                        style={{
                          ...CELL,
                          minWidth: 0,
                          maxWidth: 0,
                          overflow: "hidden",
                        }}
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          {q.services.slice(0, 2).map((s) => (
                            <Badge
                              key={s}
                              variant="soft"
                              size="sm"
                              text={labelForService(s)}
                              className={`${CHIP} ${NEUTRAL_CHIP}`}
                            />
                          ))}

                          {q.services.length > 2 && (
                            <span className="shrink-0 text-muted-foreground">
                              +{q.services.length - 2} more
                            </span>
                          )}
                        </div>
                      </TD>

                      {/* ================= STATUS ================= */}
                      <TD
                        style={{
                          ...CELL,
                          minWidth: 0,
                          maxWidth: 0,
                          overflow: "hidden",
                        }}
                      >
                        <div className="flex min-w-0 flex-col items-start gap-1.5">
                          {/* STATUS */}
                          <div className="min-w-0 max-w-full">
                            <Badge
                              variant="soft"
                              size="sm"
                              text={QUERY_STATUS_LABELS[q.status]}
                              className={`${CHIP} ${
                                STATUS_STYLES[q.status] ?? ""
                              }`}
                            />
                          </div>

                          {/* ACCEPTANCE */}
                          {(() => {
                            const chip = acceptanceChip(q.acceptance);

                            if (!chip) return null;

                            return (
                              <Badge
                                variant="soft"
                                size="sm"
                                text={chip.text}
                                icon={
                                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                                }
                                className={`${CHIP} ${chip.tone}`}
                              />
                            );
                          })()}
                        </div>
                      </TD>

                      {/* ================= ACTIONS ================= */}
                      <TD
                        style={{
                          ...CELL,
                          width: "25%",
                          minWidth: 0,
                          maxWidth: 0,
                          overflow: "hidden",
                          textAlign: "right",
                        }}
                      >
                        <div
                          className="flex min-w-0 flex-wrap items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* CLAIM */}
                          {"assignedBdoId" in q &&
                            !q.assignedBdoId &&
                            hasPermission("query.claim") && (
                              <span className="inline-flex shrink-0">
                                <Button
                                  size="xs"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => onClaim(q)}
                                  className={ACTION_BTN}
                                  iconBefore={<Hand className="h-4 w-4" />}
                                >
                                  Claim
                                </Button>
                              </span>
                            )}

                          {/* GIVE QUOTE — hidden once the quote has gone out */}
                          {NEEDS_QUOTE.includes(q.status) &&
                            hasPermission("quotation.create") && (
                              <Button
                                size="xs"
                                onClick={() => setQuoteFor(q)}
                                className={ACTION_BTN}
                                iconBefore={<FileText className="h-4 w-4" />}
                              >
                                {q.status === "revision_requested"
                                  ? "Re-quote"
                                  : "Give Quote"}
                              </Button>
                            )}

                          {/* REVIEW */}
                          {q.status === "quoted" &&
                            (canReject || canShare || canVerify) && (
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => setDecideFor(q)}
                                className={ACTION_BTN}
                                iconBefore={
                                  <CheckCircle2 className="h-4 w-4" />
                                }
                              >
                                Review
                              </Button>
                            )}

                          {/* RATE CONFIRMATION */}
                          {q.rateConfirmation &&
                            hasPermission("document.read") && (
                              <RowAction
                                title={
                                  q.rateConfirmation.verificationStatus ===
                                  "verified"
                                    ? "Download the signed Rate Confirmation"
                                    : "Download the Rate Confirmation (awaiting the customer's signed copy)"
                                }
                                disabled={rcDownloading === q.id}
                                onClick={() => downloadRc(q)}
                              >
                                {rcDownloading === q.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <FileSignature className="h-4 w-4" />
                                )}
                              </RowAction>
                            )}

                          {/* VIEW */}
                          <RowAction
                            title="View full details"
                            onClick={() => setDetailFor(q)}
                          >
                            <Eye className="h-4 w-4" />
                          </RowAction>

                          {/* REQUEST RATES — email the vendor directory about this job */}
                          {QUOTABLE.includes(q.status) &&
                            hasPermission("rfq.manage") && (
                              <RowAction
                                title="Request rates from vendors"
                                onClick={() => setRatesFor(q)}
                              >
                                <Coins className="h-4 w-4" />
                              </RowAction>
                            )}

                          {/* EDIT */}
                          {q.status === "open" &&
                            hasPermission("query.update") && (
                              <RowAction
                                title="Edit query"
                                onClick={() => setEditFor(q)}
                              >
                                <Pencil className="h-4 w-4" />
                              </RowAction>
                            )}

                          {/* CANCEL */}
                          {["open", "quoted", "revision_requested"].includes(
                            q.status,
                          ) &&
                            hasPermission("query.cancel") && (
                              <RowAction
                                title="Cancel query"
                                danger
                                onClick={() => setCancelFor(q)}
                              >
                                <XCircle className="h-4 w-4" />
                              </RowAction>
                            )}
                        </div>
                      </TD>
                    </TRow>
                  ))}
              </TBody>
            </Table>
          </div>
        </div>
      )}

      {addOpen && (
        <QueryFormModal
          mode="create"
          busy={busy}
          customers={customers}
          presetCustomerId={location.state?.customerId}
          onClose={() => {
            setAddOpen(false);
            navigate(location.pathname, { replace: true, state: null });
          }}
          onSubmit={(payload) =>
            act(() => createQuery(payload), "Query created")
          }
        />
      )}
      {editFor && (
        <QueryFormModal
          mode="edit"
          busy={busy}
          customers={customers}
          initial={editFor}
          onClose={() => setEditFor(null)}
          onSubmit={(payload) =>
            act(() => updateQuery(editFor.id, payload), "Query updated")
          }
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
          currentUserId={user?.id}
          canReject={canReject}
          canShare={canShare}
          canVerify={canVerify}
          onShare={(quoteId, payload) => shareQuotation(quoteId, payload)}
          onClose={() => setDecideFor(null)}
          // Verifying the signed copy created the shipment server-side; this screen and
          // the shipments/tasks lists all need to re-read.
          onVerified={(res) =>
            act(async () => {
              await fetchQueries();
              return {
                message:
                  res?.message ||
                  "Signed copy verified — the shipment is created",
              };
            })
          }
          onReject={(quote, reason) =>
            act(
              () => rejectQuotation(quote.id, reason),
              "Quote rejected — Ops can revise it",
            )
          }
        />
      )}
      {cancelFor && (
        <CancelQueryDialog
          busy={busy}
          query={cancelFor}
          onClose={() => setCancelFor(null)}
          onSubmit={(reason) =>
            act(() => cancelQuery(cancelFor.id, reason), "Query cancelled")
          }
        />
      )}
      {ratesFor && (
        <RequestRatesDialog query={ratesFor} onClose={() => setRatesFor(null)} />
      )}
      {detailFor && (
        <QueryDetailDialog
          query={detailFor}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
};

/* ── Query detail — everything the table no longer shows ──
      The list is down to four columns, so this dialog is the only place the contact
      block, sales owner, addresses, buy-side progress and timestamps are readable.
      Grouped into sections rather than one flat grid, because it now carries roughly
      twice what it used to. ── */
const DetailSection = ({ icon: Icon, title, action, children }) => (
  <section className="space-y-2.5">
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {title}
      </h3>
      {action}
    </div>
    {children}
  </section>
);

/**
 * One fact as its own bordered tile.
 *
 * Tiles rather than a hairline grid on purpose: half these fields are optional, so the
 * row is regularly ragged, and a `gap-px` grid over a border-coloured ground paints that
 * gap as a stripe wherever a track goes unfilled. Self-contained tiles just wrap.
 */
const Fact = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 wrap-break-word text-sm font-medium text-foreground">
        {value}
      </dd>
    </div>
  );
};

/** A contact line that is actually actionable: the email opens mail, the phone dials. */
const ContactRow = ({ icon: Icon, label, value, href }) => {
  if (!value) return null;
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2">
      {/* Guarded rather than rendered bare: this config has no eslint-plugin-react, so
          a component used only inside JSX reads as an unused variable. */}
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {href ? (
          <a
            href={href}
            className="block truncate text-sm font-medium text-foreground hover:underline"
          >
            {value}
          </a>
        ) : (
          <span className="block truncate text-sm font-medium text-foreground">
            {value}
          </span>
        )}
      </span>
    </li>
  );
};

const QueryDetailDialog = ({ query: q, onClose }) => {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [rcBusy, setRcBusy] = useState(false);

  // `assignedBdoId` is internal-only (the server withholds it from portal customers),
  // so its absence and a null value mean different things — check for the key itself.
  const owner =
    "assignedBdoId" in q
      ? (q.assignedBdoName ?? "Unassigned, in the shared pool")
      : null;
  const channel = RAISED_VIA_TO_CHANNEL[q.raisedVia];
  const acceptance = acceptanceChip(q.acceptance);
  const services = q.services ?? [];

  const downloadRc = async () => {
    setRcBusy(true);
    try {
      await documentService.downloadDocument(
        q.rateConfirmation.documentId,
        q.rateConfirmation.fileName,
      );
    } catch (err) {
      toast.error(err?.message || "Couldn't download the Rate Confirmation");
    } finally {
      setRcBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose}>
      {/* ModalHeader takes a plain string title, so the badges and the customer line
          lead the body instead. */}
      <ModalContent maxWidth="max-w-3xl" className="flex max-h-[90vh] flex-col">
        <ModalHeader
          title={q.referenceNo}
          icon={<FileSearch className="h-4 w-4 text-primary" />}
          onClose={onClose}
        />

        <ModalBody className="min-h-0 flex-1 space-y-5 overflow-y-auto">
          {/* Who and where it stands, before any of the detail. */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="soft"
                size="sm"
                text={QUERY_STATUS_LABELS[q.status]}
                className={`${CHIP} shrink-0 ${STATUS_STYLES[q.status] ?? ""}`}
              />
              {channel && (
                <Badge
                  variant="soft"
                  size="sm"
                  text={QUERY_CHANNEL_LABELS[channel] ?? channel}
                  className={`${CHIP} shrink-0 ${CHANNEL_STYLES[channel] ?? NEUTRAL_CHIP}`}
                />
              )}
              {acceptance && (
                <Badge
                  variant="soft"
                  size="sm"
                  text={acceptance.text}
                  className={`${CHIP} shrink-0 ${acceptance.tone}`}
                />
              )}
              {/* How far it goes and how it travels. Absent on queries raised before
                  these were asked, so both render only when actually answered. */}
              {q.scope && (
                <Badge
                  variant="soft"
                  size="sm"
                  text={labelForScope(q.scope)}
                  className={`${CHIP} shrink-0 ${NEUTRAL_CHIP}`}
                />
              )}
              {(q.modes ?? []).map((m) => (
                <Badge
                  key={m}
                  variant="soft"
                  size="sm"
                  text={labelForMode(m)}
                  className={`${CHIP} shrink-0 ${NEUTRAL_CHIP}`}
                />
              ))}
            </div>
            <div className="min-w-0">
              <p className="wrap-break-word text-base font-semibold text-foreground">
                {q.customerCompany}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {q.customerRef} · raised by {q.raisedByName}
              </p>
            </div>
          </div>

          {/* The lane, read as a lane. Two address cells side by side said the same
              thing but made the reader assemble the direction themselves. */}
          <DetailSection icon={MapPin} title="Route">
            <Card variant="outline" padding="sm">
              <CardBody>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Pickup
                    </p>
                    <p className="mt-0.5 wrap-break-word text-sm font-medium text-foreground">
                      {q.pickupAddress}
                    </p>
                  </div>
                  <ArrowRight
                    aria-hidden="true"
                    className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:block"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Destination
                    </p>
                    <p className="mt-0.5 wrap-break-word text-sm font-medium text-foreground">
                      {q.destinationAddress}
                    </p>
                  </div>
                </div>
                {routeOf(q) && (
                  <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                    {routeOf(q)}
                  </p>
                )}
              </CardBody>
            </Card>
          </DetailSection>

          <DetailSection icon={FileText} title="Services requested">
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No services were listed on this query.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {services.map((s) => (
                  <Badge
                    key={s}
                    variant="soft"
                    size="sm"
                    text={labelForService(s)}
                    className={`${CHIP} shrink-0 ${NEUTRAL_CHIP}`}
                  />
                ))}
              </div>
            )}
          </DetailSection>

          <DetailSection icon={User} title="Contact">
            <ul className="grid gap-1.5 sm:grid-cols-2">
              <ContactRow icon={User} label="Name" value={q.customerName} />
              <ContactRow
                icon={Mail}
                label="Email"
                value={q.customerEmail}
                href={q.customerEmail ? `mailto:${q.customerEmail}` : null}
              />
              <ContactRow
                icon={Phone}
                label="Phone"
                value={q.customerPhone}
                href={q.customerPhone ? `tel:${q.customerPhone}` : null}
              />
            </ul>
          </DetailSection>

          <DetailSection
            icon={Clock}
            title="Ownership and progress"
            action={
              q.rateConfirmation &&
              hasPermission("document.read") && (
                <Button
                  size="xs"
                  variant="outline"
                  loading={rcBusy}
                  loadingText="Preparing…"
                  iconBefore={<FileSignature className="h-3 w-3" />}
                  onClick={downloadRc}
                >
                  Rate Confirmation
                </Button>
              )
            }
          >
            <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <Fact label="Sales owner" value={owner} />
              <Fact
                label="Raised via"
                value={RAISED_VIA_LABELS[q.raisedVia] ?? q.raisedVia}
              />
              <Fact label="Created" value={fmtDate(q.createdAt)} />
              <Fact label="Last updated" value={fmtDate(q.updatedAt)} />
            </dl>

            {/* The acceptance sentence was only ever a `title` tooltip on the row.
                It says who recorded the customer's yes, through which channel and
                when, which is the whole audit story and worth reading here. */}
            {acceptance?.title && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {acceptance.title}
              </p>
            )}
          </DetailSection>

          {q.cancelReason && (
            <Callout type="error" title="This query was cancelled">
              {q.cancelReason}
            </Callout>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

const CancelQueryDialog = ({ busy, query, onClose, onSubmit }) => {
  const [reason, setReason] = useState("");
  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length < 3)
              return toast.error("A reason is required");
            onSubmit(reason.trim());
          }}
        >
          <ModalHeader
            title={`Cancel Query ${query.referenceNo}`}
            onClose={() => !busy && onClose()}
          />

          <ModalBody className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Cancellation reasons feed the unserved-demand report.
            </p>
            <Input
              id="qcancel-reason"
              label="Reason"
              value={reason}
              disabled={busy}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is the customer not going ahead?"
              wrapperClassName="w-full min-w-0"
            />
          </ModalBody>

          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Back
            </Button>
            {/* Button ships more variants than its published types list; `destructive`
                is one of them, so the danger styling comes from the design system
                rather than from a colour override here. */}
            <Button
              type="submit"
              variant="destructive"
              disabled={busy}
              loading={busy}
              loadingText="Cancelling…"
            >
              Cancel Query
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

export default QueriesListPage;
