import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus, Send, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  DatePicker,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import { labelForService, routeOf, DEFAULT_CURRENCY } from "@/lib/catalog";
import { quoteTemplateFor } from "@/lib/quoteTemplates";

/**
 * @neuctra/ui labels its own fields but exports no standalone Label, so headings for
 * grouped controls use its label styling (same helper as QueryFormModal).
 */
const FieldLabel = ({ children }) => (
  <span className="mb-1.5 block text-[13px] font-medium leading-none text-foreground">
    {children}
  </span>
);

const money = (n, ccy) =>
  `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/** The server takes `currency: z.string().length(3)`, so anything else is a 422. */
const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Local YYYY-MM-DD. `toISOString()` would convert to UTC first, which in PKT (UTC+5)
 * moves every date back a day — a quote valid to the 15th would be sent as the 14th.
 */
const toISODate = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * `scrollIntoView({ behavior: "smooth" })` ignores the OS reduced-motion setting — only
 * the CSS `scroll-behavior` property honours it — so the check has to be explicit.
 */
const scrollBehavior = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

/**
 * Give Quote — draft (and optionally send) a quotation without leaving the queries
 * list. Totals are recomputed server-side regardless of what we send (RULE-QT-02).
 *
 * Charge lines are pre-seeded from the service templates (lib/quoteTemplates.js) and
 * Ops fills in the prices from their own knowledge.
 */
const GiveQuoteDialog = ({ busy, query, canSend, onClose, onSubmit }) => {
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [validityDate, setValidityDate] = useState(null);
  const [lines, setLines] = useState(() =>
    quoteTemplateFor({
      services: query.services ?? [],
      extraServices: query.services ?? [],
    }).map((l) => ({ ...l, description: l.description ?? "", quantity: String(l.quantity ?? 1) })),
  );

  /**
   * The parent's `busy` comes from the QUERY store, while the quote is created through
   * the QUOTATION store — so on the queries-list path it never goes true and nothing
   * would guard a second click. Tracking the in-flight submit here covers both callers
   * without either having to change.
   */
  // null | "draft" | "send" — which button is in flight, so only that one spins.
  const [submittingAs, setSubmittingAs] = useState(null);
  const pending = busy || submittingAs !== null;

  /**
   * One DOM node per charge-line row. The ref lives on the row `div` rather than on the
   * Input, because @neuctra/ui's Input does not document a forwarded ref — a ref handed
   * to it could silently stay null. Querying the row for its input is stable either way.
   */
  const rowRefs = useRef([]);
  /** Index of a row just added by the button, consumed once by the effect below. */
  const scrollToRowRef = useRef(null);

  const setLine = (i, key, val) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));

  const addLine = () => {
    // Read the index off current state rather than inside the updater: an updater must
    // stay pure, and StrictMode invokes it twice in development.
    scrollToRowRef.current = lines.length;
    setLines((p) => [...p, { description: "", quantity: "1", unitPrice: "" }]);
  };

  const removeLine = (i) => setLines((p) => p.filter((_, idx) => idx !== i));

  /**
   * Bring a newly added line into view. With a long template sheet the new row lands
   * below the fold of the scrolling ModalBody, so the button appeared to do nothing.
   *
   * Runs on every length change but no-ops unless `addLine` armed it, which keeps
   * removals from yanking the scroll position around.
   */
  useEffect(() => {
    const index = scrollToRowRef.current;
    if (index == null) return;
    scrollToRowRef.current = null;

    const row = rowRefs.current[index];
    if (!row) return;
    // Focus first, without scrolling, so the browser's own focus scroll cannot fight
    // the smooth one below.
    row.querySelector("input")?.focus({ preventScroll: true });
    row.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }, [lines.length]);

  const currencyValid = CURRENCY_RE.test(currency);

  /**
   * Classify every row once: what will be sent, what is quietly skipped, and what is
   * actually wrong. The old version filtered silently, so a line with a typo'd quantity
   * either vanished from the quote or came back as a server 422 nobody could place.
   */
  const rows = useMemo(
    () =>
      lines.map((l, index) => {
        const description = String(l.description ?? "").trim();
        const rawPrice = String(l.unitPrice ?? "").trim();
        const unitPrice = Number(rawPrice);
        const hasPrice = rawPrice !== "" && Number.isFinite(unitPrice) && unitPrice >= 0;
        const rawQty = String(l.quantity ?? "").trim();
        const quantity = rawQty === "" ? 1 : Number(rawQty);

        // An untouched template row is not an error — it is just not part of this quote.
        if (!description && rawPrice === "") return { index, state: "empty" };
        if (!description) {
          return { index, state: "error", field: "description", message: "This priced line needs a description" };
        }
        if (!hasPrice) return { index, state: "skipped" };
        // The server takes `quantity: z.coerce.number().positive()`.
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return { index, state: "error", field: "quantity", message: "Quantity must be more than 0" };
        }
        return { index, state: "ready", description, quantity, unitPrice };
      }),
    [lines],
  );

  const readyRows = rows.filter((r) => r.state === "ready");
  const errorRows = rows.filter((r) => r.state === "error");
  const skippedCount = rows.filter((r) => r.state === "skipped").length;

  // Totals reflect what will actually be quoted, not every box on screen.
  const total = readyRows.reduce((s, r) => s + r.quantity * r.unitPrice, 0);

  const build = () => {
    if (!currencyValid) {
      toast.error("Enter a 3-letter currency code, e.g. PKR");
      return null;
    }
    if (errorRows.length) {
      toast.error(errorRows[0].message);
      return null;
    }
    if (!readyRows.length) {
      toast.error("Add at least one charge line with a price");
      return null;
    }
    return {
      queryId: query.id,
      currency,
      validityDate: validityDate ? toISODate(validityDate) : undefined,
      chargeLines: readyRows.map((r, i) => {
        const src = lines[r.index];
        return {
          service: src.service,
          // Carried through so resolveCharge() places the charge on the right OTD step.
          chargeCode: src.chargeCode,
          description: r.description,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          sortOrder: i,
        };
      }),
    };
  };

  const submit = async (e, alsoSend = false) => {
    e.preventDefault();
    if (pending) return;
    const payload = build();
    if (!payload) return;
    setSubmittingAs(alsoSend ? "send" : "draft");
    try {
      await onSubmit(payload, alsoSend);
    } finally {
      // A successful save unmounts this dialog, so this only matters on failure —
      // which is exactly when the form has to become usable again.
      setSubmittingAs(null);
    }
  };

  const closeIfIdle = () => {
    if (!pending) onClose();
  };

  const route = routeOf(query);
  const errorFor = (index, field) =>
    rows[index]?.state === "error" && rows[index].field === field ? rows[index].message : undefined;

  return (
    <Modal isOpen onClose={closeIfIdle} disableOverlayClose={pending}>
      {/* The body scrolls, the footer stays clear of it — a modal-level scroll leaves the
          last charge line under the sticky footer and past the end of the scroll range. */}
      <ModalContent maxWidth="max-w-3xl" className="flex max-h-[90vh] flex-col">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <ModalHeader title={`Quote ${query.referenceNo}`} onClose={closeIfIdle} />

          <ModalBody className="min-h-0 flex-1 overflow-y-auto">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {query.customerCompany}
              {route ? ` · ${route}` : ""}. Price each service below. Approval by
              the customer starts the shipment.
            </p>

            {/* What the customer asked for */}
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex flex-wrap gap-1.5">
                {(query.services ?? []).map((s) => (
                  <Badge key={s} text={labelForService(s)} variant="soft" size="sm" />
                ))}
              </div>
              {(query.customerName || query.customerPhone) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {query.customerName && (
                    <span>Contact: <b className="text-foreground">{query.customerName}</b></span>
                  )}
                  {query.customerPhone && (
                    <span>Phone: <b className="text-foreground">{query.customerPhone}</b></span>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                id="gq-ccy"
                label="Currency"
                value={currency}
                maxLength={3}
                disabled={pending}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                error={currency && !currencyValid ? "Use a 3-letter code, e.g. PKR" : undefined}
                helperText={currencyValid ? "Prices below are quoted in this currency." : undefined}
              />
              <DatePicker
                id="gq-validity"
                label="Valid until (optional)"
                value={validityDate}
                onChange={setValidityDate}
                placeholder="No expiry"
                clearable
                disabled={pending}
                // A quote that expired before it was sent helps nobody.
                calendarProps={{ minDate: startOfToday() }}
                helperText="Leave empty for a quote with no expiry date."
              />
            </div>

            {/* Charge lines */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FieldLabel>Charge lines</FieldLabel>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  onClick={addLine}
                  iconBefore={<Plus className="h-3.5 w-3.5" />}
                >
                  Add line
                </Button>
              </div>

              <div className="grid grid-cols-12 gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span className="col-span-6">Description</span>
                <span className="col-span-2">Qty</span>
                <span className="col-span-3">Unit price</span>
                <span className="col-span-1" />
              </div>

              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div
                    key={i}
                    ref={(el) => {
                      // Clear the slot on unmount so a removed row cannot leave a
                      // detached node behind for a later scroll to land on.
                      if (el) rowRefs.current[i] = el;
                      else delete rowRefs.current[i];
                    }}
                    className="space-y-1"
                  >
                    <div className="grid grid-cols-12 items-start gap-2">
                      <Input
                        size="sm"
                        placeholder="Description"
                        value={String(l.description ?? "")}
                        disabled={pending}
                        onChange={(e) => setLine(i, "description", e.target.value)}
                        error={errorFor(i, "description")}
                        wrapperClassName="col-span-6 min-w-0"
                      />
                      <Input
                        size="sm"
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="Qty"
                        value={String(l.quantity ?? "")}
                        disabled={pending}
                        onChange={(e) => setLine(i, "quantity", e.target.value)}
                        error={errorFor(i, "quantity")}
                        wrapperClassName="col-span-2 min-w-0"
                      />
                      <Input
                        size="sm"
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="Unit price"
                        value={String(l.unitPrice ?? "")}
                        disabled={pending}
                        onChange={(e) => setLine(i, "unitPrice", e.target.value)}
                        wrapperClassName="col-span-3 min-w-0"
                      />
                      <div className="col-span-1 flex justify-center pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-label="Remove charge line"
                          disabled={pending || lines.length === 1}
                          onClick={() => removeLine(i)}
                          iconBefore={<Trash2 className="h-4 w-4" />}
                          className="text-muted-foreground hover:text-destructive"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-1 text-right text-sm font-semibold">Total: {money(total, currency)}</div>

              {/* The quote only carries priced lines. Saying so beats a customer asking
                  why the line they discussed on the phone is missing. */}
              <p className="text-right text-[11px] text-muted-foreground">
                {readyRows.length} line{readyRows.length === 1 ? "" : "s"} will be quoted
                {skippedCount > 0 ? ` · ${skippedCount} without a price will be skipped` : ""}
              </p>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={canSend ? "outline" : "default"}
              disabled={pending}
              loading={submittingAs === "draft"}
              loadingText="Saving…"
              iconBefore={<FileText className="h-4 w-4" />}
            >
              Save as draft
            </Button>
            {canSend && (
              <Button
                type="button"
                disabled={pending}
                loading={submittingAs === "send"}
                loadingText="Sending…"
                onClick={(e) => submit(e, true)}
                iconBefore={<Send className="h-4 w-4" />}
              >
                Send to customer
              </Button>
            )}
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

export default GiveQuoteDialog;
