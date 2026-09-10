import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Landmark,
  RefreshCw,
  ArrowRight,
  Ban,
  Eye,
  Check,
  FileText,
  ScanLine,
  Download,
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
  IconButton,
  Skeleton,
  Spinner,
  Tooltip,
  TBody,
  TD,
  TH,
  THead,
  TRow,
  Table,
  ToggleGroup,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import { useTopicRefresh } from "@/lib/useTopicRefresh";
import { invalidate } from "@/lib/invalidationBus";
import { TOPICS } from "@/lib/topics";
import { useAuthStore } from "@/store/authStore";
import {
  listReferrals,
  setReferralStatus,
  rejectReferral,
  convertReferral,
  extractReferral,
  applyExtraction,
} from "@/services/lcService";
import { downloadDocument } from "@/services/documentService";
import { DEFAULT_CURRENCY } from "@/lib/catalog";

/**
 * Status chips, on the same recipe as the queries table: a `/10` fill and a `/30`
 * hairline over the semantic tokens, merged in last so they beat Badge's own
 * primary ramp. No `dark:` variants — the tokens carry both themes.
 */
const CHIP = "whitespace-nowrap border text-xs capitalize";
const STATUS_STYLES = {
  received: "border-info/30 bg-info/10 text-info",
  reviewing: "border-warning/30 bg-warning/10 text-warning",
  converted: "border-success/30 bg-success/10 text-success",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
};

/** Matches the queries toolbar so both screens sit on one 36px baseline. */
const ACTION_BTN = "h-9 px-3";
const ACTION_ICON_BTN = "h-9 w-9 shrink-0 p-0";

/**
 * TH/TD merge their className with plain clsx and hardcode their own padding, so a
 * padding utility from here is a coin-flip on stylesheet order. `style` is the only
 * deterministic route — same reasoning as the queries table.
 */
const HEAD_CELL = { padding: "1rem 1.5rem" };
const CELL = { padding: "1rem 1.5rem" };
/**
 * Truncation contract for a table-fixed cell: `maxWidth: 0` hands the column its width
 * from the <col> percentage instead of from its content, and only clips once overflow
 * is hidden as well. Omit the overflow and wide content silently wins the negotiation,
 * stealing the space the narrow columns were budgeted.
 */
const CLIP = { minWidth: 0, maxWidth: 0, overflow: "hidden" };

const NOT_SET = "Not set";

const money = (n, ccy = DEFAULT_CURRENCY) =>
  n == null
    ? NOT_SET
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: ccy || DEFAULT_CURRENCY,
        maximumFractionDigits: 0,
      }).format(Number(n));

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : NOT_SET);

/** One line for a lane, without printing a placeholder for each missing end. */
const lane = (from, to) =>
  [from, to].filter(Boolean).join("  →  ") || "Lane not stated";

const FILTER_OPTIONS = [
  { value: "received", label: "Received" },
  { value: "reviewing", label: "Reviewing" },
  { value: "converted", label: "Converted" },
  { value: "all", label: "All" },
];

/**
 * The LC advice attached to a referral, and the fields read out of it.
 *
 * A bank that posts to the webhook sends structured JSON; a bank that emails the
 * SWIFT printout sends a PDF and nothing else. For the second case the referral row
 * is empty until someone reads the document — so this panel does the reading, shows
 * exactly what it found, and only writes to the referral when the operator says so.
 * Nothing here is automatic: an extracted field is a suggestion until applied.
 */
const LcSourcePanel = ({ referral, canApply, onApplied }) => {
  const [state, setState] = useState({ status: "idle" }); // idle | loading | ready | none | error
  const [applying, setApplying] = useState(false);
  const [showText, setShowText] = useState(false);

  const read = async () => {
    setState({ status: "loading" });
    try {
      const res = await extractReferral(referral.id);
      setState({ status: "ready", data: res.data });
    } catch (err) {
      // 404 = no PDF attached, which is normal for webhook referrals, not an error.
      setState(
        err?.status === 404
          ? { status: "none" }
          : { status: "error", message: err?.message },
      );
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      const res = await applyExtraction(referral.id);
      toast.success(res?.message || "LC fields applied");
      await onApplied?.();
    } catch (err) {
      toast.error(err?.message || "Could not apply the LC fields");
    } finally {
      setApplying(false);
    }
  };

  const f = state.data?.fields;
  const doc = state.data?.document;

  const ROWS = f
    ? [
        ["LC number", f.lcNumber],
        ["Applicant", f.applicantName],
        ["Beneficiary", f.beneficiaryName],
        [
          "Issuing bank",
          [f.issuingBankName, f.issuingBankBic].filter(Boolean).join(" · "),
        ],
        [
          "Amount",
          f.amount != null
            ? `${f.currency ?? ""} ${Number(f.amount).toLocaleString()}`.trim()
            : null,
        ],
        ["Commodity", [f.commodity, f.quantity].filter(Boolean).join(" · ")],
        [
          "Lane",
          f.originPort || f.destinationPort
            ? lane(f.originPort, f.destinationPort)
            : null,
        ],
        ["Price term", f.priceTerm || f.incoterm],
        ["Latest shipment", fmtDate(f.latestShipmentDate)],
        ["Expiry", fmtDate(f.expiryDate)],
        [
          "Partial / transhipment",
          [f.partialShipments, f.transhipment].filter(Boolean).join(" / "),
        ],
      ].filter(([, v]) => v && v !== NOT_SET)
    : [];

  return (
    <Card padding="sm" variant="outline">
      <CardBody className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <FileText className="h-3.5 w-3.5" /> LC document
          </p>
          {state.status === "idle" && (
            <Button
              size="xs"
              variant="outline"
              iconBefore={<ScanLine className="h-3.5 w-3.5" />}
              onClick={read}
            >
              Read LC
            </Button>
          )}
        </div>

        {state.status === "loading" && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner size="xs" label="Reading" /> Reading the advice…
          </p>
        )}
        {state.status === "none" && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            No LC document attached. This referral came in through the bank webhook.
          </p>
        )}
        {state.status === "error" && (
          <Callout type="error">{state.message}</Callout>
        )}

        {state.status === "ready" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground" title={doc?.fileName}>
                {doc?.fileName}
              </span>
              <Button
                size="xs"
                variant="link"
                iconBefore={<Download className="h-3 w-3" />}
                onClick={() => downloadDocument(doc.id, doc.fileName)}
              >
                Get
              </Button>
            </div>

            {ROWS.length === 0 ? (
              <Callout type="warning">
                The PDF has no readable SWIFT tags. It may be a scan, so the fields
                need entering by hand.
              </Callout>
            ) : (
              <>
                {/* This panel and the block above it BOTH show an "Amount", and until
                    the operator applies, they disagree — the referral's is blank, this
                    one is the PDF's. That reads as a bug ("the amount is right there,
                    why is the column empty?") unless the screen says which is which. */}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Read from the PDF, <span className="font-medium">not saved yet</span>.
                  “Apply to referral” writes these onto the referral and fills the inbox
                  columns.
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {ROWS.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="whitespace-nowrap text-muted-foreground">{k}</dt>
                      <dd className="break-words font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            {/* A lane the LC states but we hold no port code for. Saying so beats
                silently converting a query with an empty destination. */}
            {f?.destinationPort && !state.data.resolved.destinationPortCode && (
              <p className="text-[11px] leading-relaxed text-warning">
                “{f.destinationPort}” is not in the ports list, so the query's
                destination stays blank until it is added.
              </p>
            )}
            {f?.originPort && !state.data.resolved.originPortCode && (
              <p className="text-[11px] leading-relaxed text-warning">
                “{f.originPort}” is not in the ports list.
              </p>
            )}

            <div className="flex items-center gap-2 pt-0.5">
              {canApply && ROWS.length > 0 && (
                <Button
                  size="xs"
                  disabled={applying}
                  loading={applying}
                  loadingText="Applying…"
                  iconBefore={<Check className="h-3 w-3" />}
                  onClick={apply}
                >
                  Apply to referral
                </Button>
              )}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setShowText((s) => !s)}
              >
                {showText ? "Hide" : "Show"} raw text
              </Button>
            </div>

            {showText && (
              <pre className="scrollbar-thin max-h-52 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-2 text-[10px] leading-relaxed">
                {state.data.text}
              </pre>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
};

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
  const load = useCallback(
    async ({ isCurrent } = {}) => {
      const ok = isCurrent ?? (() => true);
      try {
        const res = await listReferrals(filter === "all" ? undefined : filter);
        if (ok()) setReferrals(res.data || []);
      } catch (err) {
        if (ok()) toast.error(err?.message || "Could not load LC referrals");
      }
    },
    [filter],
  );

  // This inbox exists to show work that arrives from OUTSIDE the app, so it is the last
  // screen that should need a manual reload — yet it had no live path at all.
  const { run: reload } = useTopicRefresh(
    [TOPICS.LC_REFERRALS, TOPICS.QUERIES, TOPICS.CUSTOMERS],
    load,
  );

  useEffect(() => {
    reload();
  }, [filter, reload]);

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
    const res = await act(
      () => convertReferral(convertTarget.id),
      "Referral converted to query",
    );
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

  /** Nothing further can be recorded against a referral that is already resolved. */
  const isOpen = (r) => !["converted", "rejected"].includes(r?.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Bank LC Inbox
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Letters of Credit posted by partner banks
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className={ACTION_BTN}
          onClick={() => reload()}
          disabled={loading}
          iconBefore={
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          }
        >
          Refresh
        </Button>
      </div>

      {/* Status filter */}
      <ToggleGroup
        size="md"
        options={FILTER_OPTIONS}
        value={filter}
        onChange={(v) => v && setFilter(v)}
      />

      {/* EmptyState brings its own padding and icon sizing, so the Card only supplies
          the surface. The empty case replaces the table rather than living inside it:
          TD carries no `colSpan`, so a spanning "nothing here" row is not expressible. */}
      {!loading && referrals.length === 0 ? (
        <Card padding="none">
          <EmptyState
            size="lg"
            icon={<Landmark />}
            title="Nothing in this tab"
            description={
              filter === "all"
                ? "Letters of Credit forwarded by partner banks land here for review."
                : "No referrals are sitting at this stage right now."
            }
          />
        </Card>
      ) : (
        /* Table renders its own surface, plus overflow-x-auto from `responsive`.
           Wrapping it in a Card would put a second border inside it at a smaller
           radius, so the table is left to be its own card. */
        <div className="w-full min-w-0">
          <div className="w-full overflow-x-auto">
            <Table className="w-full min-w-0 table-fixed" bordered dense>
              <THead>
                <TRow>
                  <TH style={{ ...HEAD_CELL, width: "14%" }}>Ref</TH>
                  <TH
                    className="hidden lg:table-cell"
                    style={{ ...HEAD_CELL, width: "13%" }}
                  >
                    LC No.
                  </TH>
                  <TH style={{ ...HEAD_CELL, width: "23%" }}>Applicant</TH>
                  <TH
                    className="hidden md:table-cell"
                    style={{ ...HEAD_CELL, width: "12%" }}
                  >
                    Bank
                  </TH>
                  <TH
                    className="hidden sm:table-cell"
                    style={{ ...HEAD_CELL, width: "12%" }}
                  >
                    Amount
                  </TH>
                  <TH style={{ ...HEAD_CELL, width: "14%" }}>Status</TH>
                  <TH style={{ ...HEAD_CELL, width: "12%", textAlign: "right" }}>
                    Actions
                  </TH>
                </TRow>
              </THead>

              <TBody>
                {/* LOADING */}
                {loading &&
                  [...Array(4)].map((_, i) => (
                    <TRow key={i}>
                      {[...Array(7)].map((_, j) => (
                        <TD key={j} style={{ ...CELL, ...CLIP }}>
                          <Skeleton width="70%" height={16} />
                        </TD>
                      ))}
                    </TRow>
                  ))}

                {/* DATA */}
                {!loading &&
                  referrals.map((r) => (
                    <TRow key={r.id} className="bg-card!">
                      <TD
                        style={{ ...CELL, ...CLIP }}
                        className="truncate font-mono text-xs"
                      >
                        {r.referenceNo}
                      </TD>

                      <TD
                        className="hidden truncate font-mono text-xs lg:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {r.lcNumber || NOT_SET}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        <div className="truncate font-medium">
                          {r.applicantName || r.companyName || NOT_SET}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {lane(r.originPort, r.destinationPort)}
                        </div>
                      </TD>

                      <TD
                        className="hidden truncate text-xs md:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {r.bankName || NOT_SET}
                      </TD>

                      <TD
                        className="hidden truncate text-xs sm:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {money(r.amount, r.currency)}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        <Badge
                          variant="soft"
                          size="sm"
                          text={r.status}
                          className={`${CHIP} ${STATUS_STYLES[r.status] ?? "border-border bg-muted text-muted-foreground"}`}
                        />
                      </TD>

                      {/* Icon-only, like the queries table's row actions: two labelled
                          buttons cannot share a 12% column without wrapping, and a
                          wrapped action row is what pushed the last two columns out of
                          shape. Tooltip carries the name a label would have. */}
                      <TD style={{ ...CELL, ...CLIP, textAlign: "right" }}>
                        <div className="flex min-w-0 items-center justify-end gap-1.5">
                          <Tooltip content="View referral">
                            <span className="inline-flex shrink-0">
                              <IconButton
                                variant="ghost"
                                className={ACTION_ICON_BTN}
                                aria-label={`View ${r.referenceNo}`}
                                icon={<Eye className="h-4 w-4" />}
                                onClick={() => setDetail(r)}
                              />
                            </span>
                          </Tooltip>
                          {canConvert && isOpen(r) && (
                            <Tooltip content="Convert to query">
                              <span className="inline-flex shrink-0">
                                <IconButton
                                  className={ACTION_ICON_BTN}
                                  aria-label={`Convert ${r.referenceNo}`}
                                  disabled={busy}
                                  icon={<ArrowRight className="h-4 w-4" />}
                                  onClick={() => setConvertTarget(r)}
                                />
                              </span>
                            </Tooltip>
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

      {/* Detail */}
      {detail && (
        <Modal isOpen onClose={() => !busy && setDetail(null)} disableOverlayClose={busy}>
          <ModalContent maxWidth="max-w-2xl" className="flex max-h-[90vh] flex-col">
            <ModalHeader
              title={`${detail.referenceNo} · LC ${detail.lcNumber || NOT_SET}`}
              onClose={() => !busy && setDetail(null)}
            />

            <ModalBody className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="soft"
                  size="sm"
                  text={detail.status}
                  className={`${CHIP} ${STATUS_STYLES[detail.status] ?? "border-border bg-muted text-muted-foreground"}`}
                />
                <span className="text-sm text-muted-foreground">
                  {detail.bankName || "Bank"}
                  {detail.bankRef ? ` · ${detail.bankRef}` : ""}
                </span>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="whitespace-nowrap text-muted-foreground">Applicant</dt>
                <dd className="break-words font-medium">
                  {detail.applicantName || NOT_SET}
                  {detail.applicantEmail ? ` · ${detail.applicantEmail}` : ""}
                </dd>

                {detail.beneficiaryName && (
                  <>
                    <dt className="whitespace-nowrap text-muted-foreground">
                      Beneficiary
                    </dt>
                    <dd className="break-words font-medium">
                      {detail.beneficiaryName}
                    </dd>
                  </>
                )}

                <dt className="whitespace-nowrap text-muted-foreground">Lane</dt>
                <dd className="break-words font-medium">
                  {lane(detail.originPort, detail.destinationPort)}
                </dd>

                {detail.commodity && (
                  <>
                    <dt className="whitespace-nowrap text-muted-foreground">
                      Commodity
                    </dt>
                    <dd className="break-words font-medium">{detail.commodity}</dd>
                  </>
                )}

                <dt className="whitespace-nowrap text-muted-foreground">Amount</dt>
                <dd className="break-words font-medium">
                  {money(detail.amount, detail.currency)}
                  {detail.incoterm ? ` · ${detail.incoterm}` : ""}
                </dd>

                <dt className="whitespace-nowrap text-muted-foreground">
                  Issue / Expiry
                </dt>
                <dd className="break-words font-medium">
                  {fmtDate(detail.issueDate)} → {fmtDate(detail.expiryDate)}
                </dd>
              </dl>

              {detail.rejectReason && (
                <Callout type="error" title="This referral was rejected">
                  {detail.rejectReason}
                </Callout>
              )}

              {/* The advice itself, and what we can read out of it. An LC that arrives
                  as a PDF has no structured fields until someone reads them — this is
                  where that happens, under review, before anything is written. */}
              <LcSourcePanel
                referral={detail}
                canApply={canConvert && isOpen(detail)}
                onApplied={async () => {
                  await reload();
                  setDetail(null);
                }}
              />
            </ModalBody>

            {isOpen(detail) && (
              <ModalFooter>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  iconBefore={<Check className="h-3.5 w-3.5" />}
                  onClick={() =>
                    act(
                      () => setReferralStatus(detail.id, "reviewing"),
                      "Marked reviewing",
                    ).then(() => setDetail(null))
                  }
                >
                  Reviewing
                </Button>
                {canConvert && (
                  <>
                    {/* Neuctra has no destructive-outline variant, and a solid red
                        button here would outweigh Convert, which is the intended
                        action. The token text colour carries the danger instead. */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      disabled={busy}
                      iconBefore={<Ban className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setRejectTarget(detail);
                        setDetail(null);
                      }}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      iconBefore={<ArrowRight className="h-3.5 w-3.5" />}
                      onClick={() => setConvertTarget(detail)}
                    >
                      Convert
                    </Button>
                  </>
                )}
              </ModalFooter>
            )}
          </ModalContent>
        </Modal>
      )}

      {/* Convert confirm */}
      {convertTarget && (
        <Modal
          isOpen
          onClose={() => !busy && setConvertTarget(null)}
          disableOverlayClose={busy}
        >
          <ModalContent maxWidth="max-w-md">
            <ModalHeader
              title={`Convert ${convertTarget.referenceNo}?`}
              onClose={() => !busy && setConvertTarget(null)}
            />
            <ModalBody className="space-y-3">
              <p className="text-sm leading-relaxed text-muted-foreground">
                This creates a customer (source: bank LC), a lead and a query, with LC /
                Trade Finance added automatically, which Operations can then quote.
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Any field still empty on the referral is read from the attached LC first,
                so the query carries the lane, commodity and value the bank stated.
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="outline"
                onClick={() => setConvertTarget(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                disabled={busy}
                loading={busy}
                loadingText="Converting…"
                iconBefore={<ArrowRight className="h-4 w-4" />}
                onClick={doConvert}
              >
                Convert
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {/* Reject */}
      {rejectTarget && (
        <Modal
          isOpen
          onClose={() => !busy && setRejectTarget(null)}
          disableOverlayClose={busy}
        >
          <ModalContent maxWidth="max-w-md">
            <ModalHeader
              title={`Reject ${rejectTarget.referenceNo}?`}
              onClose={() => !busy && setRejectTarget(null)}
            />
            <ModalBody>
              <Input
                id="lc-reject"
                label="Reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. LC terms outside our scope"
                helperText="Retained on the referral for audit."
                disabled={busy}
              />
            </ModalBody>
            <ModalFooter>
              <Button
                variant="outline"
                onClick={() => setRejectTarget(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                loading={busy}
                loadingText="Rejecting…"
                iconBefore={<Ban className="h-4 w-4" />}
                onClick={doReject}
              >
                Reject
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </div>
  );
}
