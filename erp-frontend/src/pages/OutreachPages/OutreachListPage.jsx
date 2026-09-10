import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PhoneCall,
  RefreshCw,
  Plus,
  CalendarClock,
  AlarmClock,
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
} from "@neuctra/ui";
import toast from "react-hot-toast";
import { useOutreachStore } from "@/store/outreachStore";
import { useReferenceStore } from "@/store/referenceStore";
import { useCustomerStore } from "@/store/customerStore";
import { OutreachOutcomeBadge } from "../LeadsPages/LeadComponents/leadBadges";
import {
  CHIP,
  NEUTRAL_CHIP,
  OUTREACH_TYPE_LABELS,
  OUTREACH_OUTCOME_LABELS,
} from "../LeadsPages/LeadComponents/leadLabels";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "Not set");

/** One 36px baseline across the toolbar. */
const ACTION_BTN = "h-9 px-3";

const HEAD_CELL = { padding: "1rem 1.5rem" };
const CELL = { padding: "1rem 1.5rem" };
/**
 * `maxWidth: 0` hands a table-fixed cell its width from the column percentage rather
 * than from its content, and only clips once overflow is hidden as well.
 */
const CLIP = { minWidth: 0, maxWidth: 0, overflow: "hidden" };

/** How urgent a due follow-up is: past, today, or still ahead. */
const BUCKET_STYLES = {
  overdue: "border-destructive/30 bg-destructive/10 text-destructive",
  today: "border-warning/30 bg-warning/10 text-warning",
  upcoming: "border-info/30 bg-info/10 text-info",
};

const BUCKET_LABELS = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
};

const TARGET_OPTIONS = [
  { value: "all", label: "All targets" },
  { value: "lead", label: "Leads" },
  { value: "customer", label: "Customers" },
];

const TYPE_OPTIONS = Object.entries(OUTREACH_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);
const OUTCOME_OPTIONS = Object.entries(OUTREACH_OUTCOME_LABELS).map(
  ([value, label]) => ({ value, label }),
);

/**
 * @neuctra/ui labels its own fields but exports no standalone Label, so headings for
 * hand-built controls use its label styling (same helper as the quote dialogs).
 */
const FieldLabel = ({ htmlFor, children }) => (
  <label
    htmlFor={htmlFor}
    className="mb-1.5 block text-[13px] font-medium leading-none text-foreground"
  >
    {children}
  </label>
);

/**
 * OutreachListPage (CRM_MASTER §5.5) — the touch log across leads AND
 * customers, plus the follow-ups-due board. Completed Visit Plans appear
 * here automatically (they write an outreach row — RULE-VP-02).
 */
const OutreachListPage = () => {
  const {
    outreach,
    followUps,
    followUpCounts,
    loading,
    error,
    busy,
    filters,
    setFilter,
    fetchOutreach,
    createOutreach,
  } = useOutreachStore();
  const [addOpen, setAddOpen] = useState(false);

  // The log and the follow-ups feed arrive in one read now, so there is nothing to
  // sequence here and no half-refreshed state to reason about.
  useEffect(() => {
    fetchOutreach();
  }, [fetchOutreach]);

  const refresh = () => fetchOutreach();

  const submit = async (payload) => {
    try {
      // Through the store: logging a touch can advance a lead new → contacted, and the
      // Leads list has to hear about that.
      const res = await createOutreach(payload);
      toast.success(res?.message || "Outreach logged");
      setAddOpen(false);
    } catch (err) {
      toast.error(err?.message || "Failed to log outreach");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <PhoneCall className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Outreach
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Touches on leads and customers · follow-ups due
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={ACTION_BTN}
            onClick={refresh}
            disabled={loading}
            iconBefore={
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            }
          >
            Refresh
          </Button>
          <Select
            size="md"
            value={filters.target || "all"}
            onValueChange={(v) => setFilter("target", v === "all" ? "" : v)}
            options={TARGET_OPTIONS}
            placeholder="Target"
            showCheckIcon={false}
            className="w-36!"
            containerClassName="w-36"
            triggerClassName="h-9"
          />
          <Button
            size="sm"
            className={ACTION_BTN}
            onClick={() => setAddOpen(true)}
            iconBefore={<Plus className="h-4 w-4" />}
          >
            Log Outreach
          </Button>
        </div>
      </div>

      {/* Follow-ups-due board (§5.5). `padding="none"` lets the rows run edge to edge
          so their dividers meet the card border. */}
      <Card padding="none" className="overflow-hidden">
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-accent px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlarmClock className="h-4 w-4 text-primary" /> Follow-ups Due
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="soft"
                size="sm"
                text={`Overdue ${followUpCounts.overdue}`}
                className={`${CHIP} ${BUCKET_STYLES.overdue}`}
              />
              <Badge
                variant="soft"
                size="sm"
                text={`Today ${followUpCounts.today}`}
                className={`${CHIP} ${BUCKET_STYLES.today}`}
              />
              <Badge
                variant="soft"
                size="sm"
                text={`Next 7d ${followUpCounts.upcoming}`}
                className={`${CHIP} ${BUCKET_STYLES.upcoming}`}
              />
            </div>
          </div>

          <div className="max-h-64 divide-y divide-border overflow-y-auto">
            {followUps.map((f) => (
              <div
                key={f.id}
                className="flex flex-col gap-1.5 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-3"
              >
                <Badge
                  variant="soft"
                  size="sm"
                  text={BUCKET_LABELS[f.bucket] ?? f.bucket}
                  className={`${CHIP} w-20 justify-center ${BUCKET_STYLES[f.bucket] ?? NEUTRAL_CHIP}`}
                />
                <span className="min-w-0 flex-1 truncate">
                  {f.targetType === "lead" ? (
                    <Link
                      to={`/admin/leads/${f.targetId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {f.targetCompany}
                    </Link>
                  ) : (
                    <span className="font-medium">{f.targetCompany}</span>
                  )}
                  <span className="text-muted-foreground">
                    {" "}
                    ({f.targetRef}) · {OUTREACH_TYPE_LABELS[f.type]}
                    {f.notes ? ` · ${f.notes}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" /> {fmt(f.followUpAt)}
                </span>
              </div>
            ))}

            {followUps.length === 0 && (
              <EmptyState
                size="sm"
                icon={<AlarmClock className="h-5 w-5" />}
                title="Nothing due"
                description="Log outreach with a follow-up date and it lands here."
              />
            )}
          </div>
        </CardBody>
      </Card>

      {error && (
        <Callout type="error" title="Couldn't load the outreach log">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={refresh}>
              Retry
            </Button>
          </div>
        </Callout>
      )}

      {/* Touch log */}
      {!loading && outreach.length === 0 && !error ? (
        <Card padding="none">
          <EmptyState
            size="lg"
            icon={<PhoneCall />}
            title="No outreach logged yet"
            description="Every call, email and meeting recorded against a lead or customer shows up here, including completed visit plans."
          />
        </Card>
      ) : (
        <div className="w-full min-w-0">
          <div className="w-full overflow-x-auto">
            <Table className="w-full min-w-0 table-fixed" bordered dense>
              <THead>
                <TRow>
                  <TH style={{ ...HEAD_CELL, width: "15%" }}>When</TH>
                  <TH style={{ ...HEAD_CELL, width: "22%" }}>Target</TH>
                  <TH style={{ ...HEAD_CELL, width: "11%" }}>Type</TH>
                  <TH style={{ ...HEAD_CELL, width: "13%" }}>Outcome</TH>
                  <TH
                    className="hidden md:table-cell"
                    style={{ ...HEAD_CELL, width: "19%" }}
                  >
                    Notes
                  </TH>
                  <TH
                    className="hidden lg:table-cell"
                    style={{ ...HEAD_CELL, width: "10%" }}
                  >
                    By
                  </TH>
                  <TH
                    className="hidden sm:table-cell"
                    style={{ ...HEAD_CELL, width: "10%" }}
                  >
                    Follow-up
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
                  outreach.map((o) => (
                    <TRow key={o.id} className="bg-card!">
                      <TD
                        className="truncate text-muted-foreground"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {fmt(o.occurredAt)}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        <div className="truncate">
                          {o.targetType === "lead" ? (
                            <Link
                              to={`/admin/leads/${o.targetId}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {o.targetCompany}
                            </Link>
                          ) : (
                            <span className="font-medium">
                              {o.targetCompany}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {o.targetRef}
                        </div>
                      </TD>

                      <TD className="truncate" style={{ ...CELL, ...CLIP }}>
                        {OUTREACH_TYPE_LABELS[o.type] ?? o.type}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        <OutreachOutcomeBadge outcome={o.outcome} />
                      </TD>

                      <TD
                        className="hidden truncate text-muted-foreground md:table-cell"
                        style={{ ...CELL, ...CLIP }}
                        title={o.notes ?? undefined}
                      >
                        {o.notes ?? "None"}
                      </TD>

                      <TD
                        className="hidden truncate text-muted-foreground lg:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {o.actorName}
                      </TD>

                      <TD
                        className="hidden truncate text-muted-foreground sm:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {o.followUpAt ? fmt(o.followUpAt) : "None"}
                      </TD>
                    </TRow>
                  ))}
              </TBody>
            </Table>
          </div>
        </div>
      )}

      {addOpen && (
        <LogOutreachDialog
          busy={busy}
          onClose={() => setAddOpen(false)}
          onSubmit={submit}
        />
      )}
    </div>
  );
};

/* ── Log outreach — target a lead (pipeline) or a customer (retention) ── */
const LogOutreachDialog = ({ busy, onClose, onSubmit }) => {
  // referenceStore, NOT useLeadStore: that store applies the Leads PAGE's filters, so
  // setting that page's filter to e.g. "lost" silently emptied this dropdown, and no
  // amount of reloading fixed it because the filter was the cause.
  const { leads, fetch: fetchReference } = useReferenceStore();
  const { customers, fetchCustomers } = useCustomerStore();
  const [form, setForm] = useState({
    targetType: "lead",
    targetId: "",
    type: "call",
    outcome: "neutral",
    notes: "",
    durationMin: "",
    followUpAt: "",
  });

  useEffect(() => {
    fetchReference("leads");
    fetchCustomers();
  }, [fetchReference, fetchCustomers]);

  const openLeads = leads.filter((l) =>
    ["new", "contacted", "qualified"].includes(l.status),
  );
  const activeCustomers = customers.filter((c) => c.isActive);

  const targetOptions = (
    form.targetType === "lead" ? openLeads : activeCustomers
  ).map((t) => ({
    value: t.id,
    label:
      form.targetType === "lead"
        ? `${t.referenceNo} · ${t.company?.name ?? ""}`
        : `${t.referenceNo} · ${t.companyName}`,
  }));

  const submit = (e) => {
    e.preventDefault();
    if (!form.targetId) return toast.error("Pick a lead or customer");
    onSubmit({
      ...(form.targetType === "lead"
        ? { leadId: form.targetId }
        : { customerId: form.targetId }),
      type: form.type,
      outcome: form.outcome,
      notes: form.notes || undefined,
      durationMin: form.durationMin ? Number(form.durationMin) : undefined,
      followUpAt: form.followUpAt || undefined,
    });
  };

  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-2xl" className="flex max-h-[90vh] flex-col">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <ModalHeader
            title="Log Outreach"
            onClose={() => !busy && onClose()}
          />

          <ModalBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Records a touch that already happened. The first touch on a new
              lead moves it to Contacted; scheduled future visits belong in Visit
              Plans.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Target type"
                value={form.targetType}
                onValueChange={(v) =>
                  setForm((p) => ({ ...p, targetType: v, targetId: "" }))
                }
                options={[
                  { value: "lead", label: "Lead" },
                  { value: "customer", label: "Customer" },
                ]}
                disabled={busy}
              />
              <Select
                label={form.targetType === "lead" ? "Lead" : "Customer"}
                value={form.targetId}
                onValueChange={(v) => setForm((p) => ({ ...p, targetId: v }))}
                options={targetOptions}
                placeholder="Select…"
                searchable
                disabled={busy}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Type"
                value={form.type}
                onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}
                options={TYPE_OPTIONS}
                disabled={busy}
              />
              <Select
                label="Outcome"
                value={form.outcome}
                onValueChange={(v) => setForm((p) => ({ ...p, outcome: v }))}
                options={OUTCOME_OPTIONS}
                disabled={busy}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                id="or-duration"
                type="number"
                label="Duration (min)"
                min={1}
                value={form.durationMin}
                onChange={(e) =>
                  setForm((p) => ({ ...p, durationMin: e.target.value }))
                }
                placeholder="Optional"
                disabled={busy}
              />
              <div>
                {/* A follow-up carries a time as well as a date, and @neuctra/ui has no
                    datetime control (DatePicker is date-only). A native input keeps the
                    stored value intact rather than flattening it to midnight; the token
                    classes give it the same surface as the fields beside it. */}
                <FieldLabel htmlFor="or-followup">
                  Follow-up (optional)
                </FieldLabel>
                <input
                  id="or-followup"
                  type="datetime-local"
                  value={form.followUpAt}
                  disabled={busy}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, followUpAt: e.target.value }))
                  }
                  className="h-10 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                />
              </div>
            </div>

            <Input
              id="or-notes"
              label="Notes"
              value={form.notes}
              onChange={(e) =>
                setForm((p) => ({ ...p, notes: e.target.value }))
              }
              placeholder="What happened?"
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
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              loading={busy}
              loadingText="Logging…"
              iconBefore={<Plus className="h-4 w-4" />}
            >
              Log
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

export default OutreachListPage;
