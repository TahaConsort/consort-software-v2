import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  RefreshCw,
  Send,
  Check,
  X,
  RotateCcw,
  Eye,
} from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  IconButton,
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
  Tooltip,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import { useQuotationStore } from "@/store/quotationStore";
import { useAuthStore } from "@/store/authStore";
import * as quotationService from "@/services/quotationService";
import {
  QUOTATION_STATUS_LABELS,
  QUOTE_SHARE_CHANNEL_LABELS,
  labelForService,
  DEFAULT_CURRENCY,
} from "@/lib/catalog";

/**
 * Status chips on the queries-table recipe: a `/10` fill and a `/30` hairline over the
 * semantic tokens, merged in last so they beat Badge's own primary ramp. `expired` and
 * `rejected` share the destructive ramp — both are dead ends — and separate themselves
 * with a dashed border rather than inventing a sixth hue.
 */
const CHIP = "whitespace-nowrap border text-xs";
const STATUS_STYLES = {
  draft: "border-border bg-muted text-muted-foreground",
  sent: "border-warning/30 bg-warning/10 text-warning",
  approved: "border-success/30 bg-success/10 text-success",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
  expired: "border-dashed border-destructive/50 bg-destructive/10 text-destructive",
};

/** One 36px baseline across the toolbar and the row actions, as on queries. */
const ACTION_BTN = "h-9 px-3";
const ACTION_ICON_BTN = "h-9 w-9 shrink-0 p-0";

/**
 * TH/TD merge their className with plain clsx and hardcode their own padding, so a
 * padding utility from here is a coin-flip on stylesheet order — `style` is the only
 * deterministic route.
 */
const HEAD_CELL = { padding: "1rem 1.5rem" };
const CELL = { padding: "1rem 1.5rem" };
/**
 * `maxWidth: 0` hands a table-fixed cell its width from the column percentage rather
 * than from its content, and only clips once overflow is hidden as well. Drop the
 * overflow and wide content wins the width negotiation, starving the narrow columns.
 */
const CLIP = { minWidth: 0, maxWidth: 0, overflow: "hidden" };

const money = (n, ccy) =>
  `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...Object.entries(QUOTATION_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

/** Icon-only row action, so four controls fit one column without wrapping. */
const RowAction = ({ title, onClick, disabled, danger, tone, children }) => (
  <Tooltip content={title}>
    <span className="inline-flex shrink-0">
      <IconButton
        variant="ghost"
        className={`${ACTION_ICON_BTN} ${
          danger
            ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            : tone === "success"
              ? "text-success hover:bg-success/10"
              : "text-muted-foreground hover:text-foreground"
        }`}
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
        icon={children}
      />
    </span>
  </Tooltip>
);

/**
 * QuotationsListPage — the record of every quotation raised.
 *
 * Deliberately read-plus-decide, not read-write: a quotation is drafted from the query
 * it prices (the Give Quote dialog on the queries screen), never from a blank form
 * here. What this screen owns is the lifecycle after that — send, approve, reject,
 * revise — and the record of what was quoted.
 */
const QuotationsListPage = () => {
  const {
    quotations,
    loading,
    error,
    filters,
    setFilter,
    fetchQuotations,
    sendQuotation,
    approveQuotation,
    rejectQuotation,
    reviseQuotation,
  } = useQuotationStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();

  const [detailFor, setDetailFor] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchQuotations();
  }, [fetchQuotations]);

  const act = async (fn, successMsg, after) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(successMsg || res?.message);
      setRejectFor(null);
      setDetailFor(null);
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
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Quotations
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every quote raised, and where it stands
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={ACTION_BTN}
            onClick={fetchQuotations}
            disabled={loading}
            iconBefore={
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
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
        </div>
      </div>

      {/* A quote is drafted from the query it prices, so say where that happens rather
          than leaving someone hunting this screen for a New button that never existed. */}
      <Callout type="neutral">
        Quotations are drafted from the query they price. Open a query on the Queries
        screen and use Give Quote; this page is the record of what was quoted.
      </Callout>

      {error && (
        <Callout type="error" title="Couldn't load the quotations">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={fetchQuotations}>
              Retry
            </Button>
          </div>
        </Callout>
      )}

      {/* EmptyState brings its own padding and icon sizing, so the Card only supplies
          the surface. The empty case replaces the table rather than living inside it:
          TD carries no `colSpan`, so a spanning "nothing here" row is not expressible. */}
      {!loading && quotations.length === 0 && !error ? (
        <Card padding="none">
          <EmptyState
            size="lg"
            icon={<FileText />}
            title="No quotations yet"
            description="Quotes raised against a query will show up here once Ops drafts one."
          />
        </Card>
      ) : (
        /* Table renders its own surface, plus overflow-x-auto from `responsive`.
           Wrapping it in a Card would nest a second border at a smaller radius. */
        <div className="w-full min-w-0">
          <div className="w-full overflow-x-auto">
            <Table className="w-full min-w-0 table-fixed" bordered dense>
              <THead>
                <TRow>
                  <TH style={{ ...HEAD_CELL, width: "18%" }}>Ref</TH>
                  <TH style={{ ...HEAD_CELL, width: "30%" }}>Query / Customer</TH>
                  <TH
                    className="hidden sm:table-cell"
                    style={{ ...HEAD_CELL, width: "16%" }}
                  >
                    Total
                  </TH>
                  <TH style={{ ...HEAD_CELL, width: "15%" }}>Status</TH>
                  <TH style={{ ...HEAD_CELL, width: "21%", textAlign: "right" }}>
                    Actions
                  </TH>
                </TRow>
              </THead>

              <TBody>
                {/* LOADING */}
                {loading &&
                  [...Array(4)].map((_, i) => (
                    <TRow key={i}>
                      {[...Array(5)].map((_, j) => (
                        <TD key={j} style={{ ...CELL, ...CLIP }}>
                          <Skeleton width="70%" height={16} />
                        </TD>
                      ))}
                    </TRow>
                  ))}

                {/* DATA */}
                {!loading &&
                  quotations.map((q) => (
                    <TRow
                      key={q.id}
                      className="bg-card! cursor-pointer"
                      onClick={() => setDetailFor(q)}
                    >
                      <TD style={{ ...CELL, ...CLIP }}>
                        <div className="flex min-w-0 items-baseline gap-1.5">
                          <span className="truncate font-medium text-primary">
                            {q.referenceNo}
                          </span>
                          {q.version > 1 && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              v{q.version}
                            </span>
                          )}
                        </div>
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        <div className="truncate font-medium">
                          {q.customerCompany}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {q.queryRef}
                        </div>
                      </TD>

                      <TD
                        className="hidden truncate font-medium sm:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {money(q.totalAmount, q.currency)}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        <Badge
                          variant="soft"
                          size="sm"
                          text={QUOTATION_STATUS_LABELS[q.status] ?? q.status}
                          className={`${CHIP} ${STATUS_STYLES[q.status] ?? STATUS_STYLES.draft}`}
                        />
                      </TD>

                      <TD style={{ ...CELL, ...CLIP, textAlign: "right" }}>
                        {/* The row itself opens the detail, so these must not bubble. */}
                        <div
                          className="flex min-w-0 items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <RowAction
                            title="View details"
                            onClick={() => setDetailFor(q)}
                          >
                            <Eye className="h-4 w-4" />
                          </RowAction>

                          {q.status === "draft" &&
                            hasPermission("quotation.send") && (
                              <RowAction
                                title="Send to customer"
                                disabled={busy}
                                onClick={() =>
                                  act(() => sendQuotation(q.id), "Quotation sent")
                                }
                              >
                                <Send className="h-4 w-4" />
                              </RowAction>
                            )}

                          {q.status === "sent" &&
                            hasPermission("quotation.approve") && (
                              <RowAction
                                title="Approve"
                                tone="success"
                                disabled={busy}
                                onClick={() =>
                                  act(
                                    () => approveQuotation(q.id, q.rowVersion),
                                    "Approved",
                                    (r) =>
                                      r?.data?.shipmentId &&
                                      navigate(`/admin/shipments/${r.data.shipmentId}`),
                                  )
                                }
                              >
                                <Check className="h-4 w-4" />
                              </RowAction>
                            )}

                          {q.status === "sent" &&
                            hasPermission("quotation.reject") && (
                              <RowAction
                                title="Reject"
                                danger
                                disabled={busy}
                                onClick={() => setRejectFor(q)}
                              >
                                <X className="h-4 w-4" />
                              </RowAction>
                            )}

                          {["rejected", "expired"].includes(q.status) &&
                            hasPermission("quotation.revise") && (
                              <RowAction
                                title="Draft a revision"
                                disabled={busy}
                                onClick={() =>
                                  act(
                                    () => reviseQuotation(q.id),
                                    "Revision drafted",
                                  )
                                }
                              >
                                <RotateCcw className="h-4 w-4" />
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

      {detailFor && (
        <QuotationDetailDialog
          quotation={detailFor}
          onClose={() => setDetailFor(null)}
        />
      )}
      {rejectFor && (
        <RejectDialog
          busy={busy}
          quotation={rejectFor}
          onClose={() => setRejectFor(null)}
          onSubmit={(reason) =>
            act(() => rejectQuotation(rejectFor.id, reason), "Quotation rejected")
          }
        />
      )}
    </div>
  );
};

/* ── What was quoted: the charge sheet as the customer sees it. ── */
const QuotationDetailDialog = ({ quotation, onClose }) => {
  // The row carries enough to paint immediately; the full record (charge lines, share
  // record) arrives a moment later and replaces it, so the dialog never opens blank.
  const [full, setFull] = useState(quotation);
  useEffect(() => {
    let alive = true;
    quotationService
      .getQuotation(quotation.id)
      .then((r) => {
        if (alive) setFull(r.data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [quotation.id]);

  const lines = full.chargeLines ?? [];

  return (
    <Modal isOpen onClose={onClose}>
      <ModalContent maxWidth="max-w-2xl" className="flex max-h-[90vh] flex-col">
        <ModalHeader
          title={`${full.referenceNo}${full.version > 1 ? ` · v${full.version}` : ""}`}
          onClose={onClose}
        />

        <ModalBody className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="soft"
              size="sm"
              text={QUOTATION_STATUS_LABELS[full.status] ?? full.status}
              className={`${CHIP} ${STATUS_STYLES[full.status] ?? STATUS_STYLES.draft}`}
            />
            <span className="text-sm text-muted-foreground">
              {full.customerCompany} · {full.queryRef}
            </span>
          </div>

          {(full.services ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {full.services.map((s) => (
                <Badge key={s} variant="soft" size="sm" text={labelForService(s)} />
              ))}
            </div>
          )}

          {lines.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<FileText className="h-5 w-5" />}
              title="No charge lines"
              description="This quotation carries no priced lines."
            />
          ) : (
            <div className="w-full overflow-x-auto">
              <Table className="w-full" bordered dense>
                <THead>
                  <TRow>
                    <TH>Description</TH>
                    <TH style={{ textAlign: "right" }}>Qty</TH>
                    <TH style={{ textAlign: "right" }}>Unit</TH>
                    <TH style={{ textAlign: "right" }}>Amount</TH>
                  </TRow>
                </THead>
                <TBody>
                  {lines.map((l) => (
                    <TRow key={l.id}>
                      <TD>{l.description}</TD>
                      <TD style={{ textAlign: "right" }}>{Number(l.quantity)}</TD>
                      <TD style={{ textAlign: "right" }}>
                        {Number(l.unitPrice).toLocaleString()}
                      </TD>
                      <TD style={{ textAlign: "right" }} className="font-medium">
                        {Number(l.amount).toLocaleString()}
                      </TD>
                    </TRow>
                  ))}
                </TBody>
              </Table>
            </div>
          )}

          <div className="text-right text-sm font-semibold">
            Total: {money(full.totalAmount, full.currency)}
          </div>

          {/* BDO's relay record — how the quote reached the customer (mail/phone/…) */}
          {full.sharedAt && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Given to the customer via{" "}
              {QUOTE_SHARE_CHANNEL_LABELS[full.sharedVia] ?? full.sharedVia} on{" "}
              {new Date(full.sharedAt).toLocaleDateString()}
              {full.shareNote ? `. ${full.shareNote}` : ""}
            </p>
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

const RejectDialog = ({ busy, quotation, onClose, onSubmit }) => {
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
            title={`Reject ${quotation.referenceNo}`}
            onClose={() => !busy && onClose()}
          />
          <ModalBody className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              The query moves to &quot;revision requested&quot; so Ops can re-quote
              (ADR-030).
            </p>
            <Input
              id="qt-reject"
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. price above the customer's budget"
              disabled={busy}
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
            <Button
              type="submit"
              variant="destructive"
              disabled={busy}
              loading={busy}
              loadingText="Rejecting…"
            >
              Reject
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

export default QuotationsListPage;
