import { useEffect, useState } from "react";
import {
  CalendarClock,
  RefreshCw,
  Plus,
  CheckCircle2,
  XCircle,
  UserX,
  RotateCcw,
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
import { useVisitStore } from "@/store/visitStore";
import { useReferenceStore } from "@/store/referenceStore";
import { useCustomerStore } from "@/store/customerStore";
import { useAuthStore } from "@/store/authStore";
import { VISIT_STATUS_LABELS } from "@/lib/catalog";
import {
  CHIP,
  NEUTRAL_CHIP,
  OUTREACH_OUTCOME_LABELS,
} from "../LeadsPages/LeadComponents/leadLabels";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "Not set");

/** One 36px baseline across the toolbar and the row actions. */
const ACTION_BTN = "h-9 px-3";
const ACTION_ICON_BTN = "h-9 w-9 shrink-0 p-0";

const HEAD_CELL = { padding: "1rem 1.5rem" };
const CELL = { padding: "1rem 1.5rem" };
/**
 * `maxWidth: 0` hands a table-fixed cell its width from the column percentage rather
 * than from its content, and only clips once overflow is hidden as well.
 */
const CLIP = { minWidth: 0, maxWidth: 0, overflow: "hidden" };

/** Planned is ahead, completed is the win, no-show is the failure, cancelled is neutral. */
const STATUS_STYLES = {
  planned: "border-info/30 bg-info/10 text-info",
  completed: "border-success/30 bg-success/10 text-success",
  cancelled: NEUTRAL_CHIP,
  no_show: "border-destructive/30 bg-destructive/10 text-destructive",
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

/** A visit debrief records how it went; a no-show is its own status, not an outcome. */
const OUTCOME_OPTIONS = ["positive", "neutral", "negative"].map((value) => ({
  value,
  label: OUTREACH_OUTCOME_LABELS[value],
}));

/**
 * A visit carries a time as well as a date, and @neuctra/ui has no datetime control
 * (DatePicker is date-only). A native input keeps the stored value intact rather than
 * flattening it to midnight; the token classes give it the same surface as the Input
 * fields beside it, and the label matches Input's own label styling.
 */
const DateTimeField = ({ id, label, value, onChange, disabled, required }) => (
  <div>
    <label
      htmlFor={id}
      className="mb-1.5 block text-[13px] font-medium leading-none text-foreground"
    >
      {label}
    </label>
    <input
      id={id}
      type="datetime-local"
      value={value}
      onChange={onChange}
      disabled={disabled}
      required={required}
      className="h-10 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    />
  </div>
);

/** Icon-only row action, so four controls fit one column without wrapping. */
const RowAction = ({ title, onClick, disabled, danger, children }) => (
  <Tooltip content={title}>
    <span className="inline-flex shrink-0">
      <IconButton
        variant="ghost"
        className={`${ACTION_ICON_BTN} text-muted-foreground ${
          danger
            ? "hover:bg-destructive/10 hover:text-destructive"
            : "hover:text-foreground"
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
 * VisitsListPage — scheduled field visits (ADR-043, WORKFLOW §2a).
 * Completing a visit records an outreach touch and can advance the lead
 * machine (RULE-VP-02); a no-show escalates BDO → ASM (RULE-VP-04).
 */
const VisitsListPage = () => {
  const {
    visits,
    loading,
    error,
    busy,
    filters,
    setFilter,
    fetchVisits,
    createVisit,
    completeVisit,
    noShowVisit,
    cancelVisit,
    rescheduleVisit,
  } = useVisitStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [dialog, setDialog] = useState(null); // { kind, visit } | null

  useEffect(() => {
    fetchVisits();
  }, [fetchVisits]);

  // The store owns the refetch and the cross-list invalidation: completing or missing a
  // visit writes an outreach touch and can advance the lead (RULE-VP-02), so the Outreach
  // and Leads screens have to hear about it too.
  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      setDialog(null);
    } catch (err) {
      toast.error(err?.message || "Couldn't update the visit");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Visit Plans
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Scheduled field visits to win and retain clients
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={ACTION_BTN}
            onClick={fetchVisits}
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
            className="w-40!"
            containerClassName="w-40"
            triggerClassName="h-9"
          />
          {hasPermission("visit.create") && (
            <Button
              size="sm"
              className={ACTION_BTN}
              onClick={() => setDialog({ kind: "add" })}
              iconBefore={<Plus className="h-4 w-4" />}
            >
              Plan Visit
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Callout type="error" title="Couldn't load the visits">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={fetchVisits}>
              Retry
            </Button>
          </div>
        </Callout>
      )}

      {/* EmptyState brings its own padding and icon sizing, so the Card only supplies
          the surface. The empty case replaces the table rather than living inside it:
          TD carries no `colSpan`, so a spanning "nothing here" row is not expressible. */}
      {!loading && visits.length === 0 && !error ? (
        <Card padding="none">
          <EmptyState
            size="lg"
            icon={<CalendarClock />}
            title="No visits planned"
            description="Plan a visit against a lead or a customer; completing it logs an outreach touch automatically."
            action={
              hasPermission("visit.create") ? (
                <Button
                  size="sm"
                  onClick={() => setDialog({ kind: "add" })}
                  iconBefore={<Plus className="h-4 w-4" />}
                >
                  Plan Visit
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="w-full min-w-0">
          <div className="w-full overflow-x-auto">
            <Table className="w-full min-w-0 table-fixed" bordered dense>
              <THead>
                <TRow>
                  <TH style={{ ...HEAD_CELL, width: "15%" }}>When</TH>
                  <TH style={{ ...HEAD_CELL, width: "20%" }}>Target</TH>
                  <TH
                    className="hidden md:table-cell"
                    style={{ ...HEAD_CELL, width: "16%" }}
                  >
                    Purpose
                  </TH>
                  <TH
                    className="hidden sm:table-cell"
                    style={{ ...HEAD_CELL, width: "13%" }}
                  >
                    Location
                  </TH>
                  <TH
                    className="hidden lg:table-cell"
                    style={{ ...HEAD_CELL, width: "11%" }}
                  >
                    Assigned
                  </TH>
                  <TH style={{ ...HEAD_CELL, width: "11%" }}>Status</TH>
                  <TH style={{ ...HEAD_CELL, width: "14%", textAlign: "right" }}>
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
                  visits.map((v) => (
                    <TRow key={v.id} className="bg-card!">
                      <TD
                        className="truncate font-medium"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {fmt(v.plannedAt)}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        <div className="truncate font-medium">
                          {v.targetCompany}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {v.targetRef}
                        </div>
                      </TD>

                      <TD
                        className="hidden truncate text-muted-foreground md:table-cell"
                        style={{ ...CELL, ...CLIP }}
                        title={v.purpose}
                      >
                        {v.purpose}
                      </TD>

                      <TD
                        className="hidden truncate text-muted-foreground sm:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {v.location}
                      </TD>

                      <TD
                        className="hidden truncate text-muted-foreground lg:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {v.assignedToName}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        <Badge
                          variant="soft"
                          size="sm"
                          text={VISIT_STATUS_LABELS[v.status] ?? v.status}
                          className={`${CHIP} ${STATUS_STYLES[v.status] ?? NEUTRAL_CHIP}`}
                        />
                      </TD>

                      <TD style={{ ...CELL, ...CLIP, textAlign: "right" }}>
                        <div className="flex min-w-0 items-center justify-end gap-1.5">
                          {v.status === "planned" && (
                            <>
                              <RowAction
                                title="Complete this visit"
                                disabled={busy}
                                onClick={() =>
                                  setDialog({ kind: "complete", visit: v })
                                }
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </RowAction>
                              <RowAction
                                title="Mark as a no-show"
                                disabled={busy}
                                onClick={() =>
                                  act(() => noShowVisit(v.id), "Marked no-show")
                                }
                              >
                                <UserX className="h-4 w-4" />
                              </RowAction>
                              <RowAction
                                title="Cancel this visit"
                                danger
                                disabled={busy}
                                onClick={() =>
                                  setDialog({ kind: "cancel", visit: v })
                                }
                              >
                                <XCircle className="h-4 w-4" />
                              </RowAction>
                            </>
                          )}
                          {["planned", "no_show"].includes(v.status) && (
                            <RowAction
                              title="Reschedule"
                              disabled={busy}
                              onClick={() =>
                                setDialog({ kind: "reschedule", visit: v })
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

      {/* Dialogs */}
      {dialog?.kind === "add" && (
        <AddVisitDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => act(() => createVisit(payload), "Visit planned")}
        />
      )}
      {dialog?.kind === "complete" && (
        <CompleteDialog
          busy={busy}
          visit={dialog.visit}
          onClose={() => setDialog(null)}
          onSubmit={(payload) =>
            act(() => completeVisit(dialog.visit.id, payload), "Visit completed")
          }
        />
      )}
      {dialog?.kind === "cancel" && (
        <CancelDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(reason) =>
            act(() => cancelVisit(dialog.visit.id, reason), "Visit cancelled")
          }
        />
      )}
      {dialog?.kind === "reschedule" && (
        <RescheduleDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(plannedAt) =>
            act(() => rescheduleVisit(dialog.visit.id, plannedAt), "Rescheduled")
          }
        />
      )}
    </div>
  );
};

/* ── Plan a visit — target one of lead / customer (DATABASE §5 CHECK) ── */
const AddVisitDialog = ({ busy, onClose, onSubmit }) => {
  // referenceStore, NOT useLeadStore: that store applies the Leads PAGE's filters, so
  // whatever the user last filtered by there silently emptied this dropdown, and
  // reloading never helped because the filter was the cause.
  const { leads, fetch: fetchReference } = useReferenceStore();
  const { customers, fetchCustomers } = useCustomerStore();
  const [form, setForm] = useState({
    targetType: "lead",
    targetId: "",
    purpose: "",
    plannedAt: "",
    location: "",
  });

  useEffect(() => {
    fetchReference("leads");
    fetchCustomers();
  }, [fetchReference, fetchCustomers]);

  const openLeads = leads.filter((l) =>
    ["new", "contacted", "qualified"].includes(l.status),
  );

  const targetOptions = (
    form.targetType === "lead" ? openLeads : customers
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
    if (!form.plannedAt) return toast.error("Pick a date and time");
    onSubmit({
      ...(form.targetType === "lead"
        ? { leadId: form.targetId }
        : { customerId: form.targetId }),
      purpose: form.purpose,
      plannedAt: form.plannedAt,
      location: form.location,
    });
  };

  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-2xl" className="flex max-h-[90vh] flex-col">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <ModalHeader title="Plan a Visit" onClose={() => !busy && onClose()} />

          <ModalBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <p className="text-sm leading-relaxed text-muted-foreground">
              A completed visit counts as an outreach touch on the target.
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

            <Input
              id="visit-purpose"
              label="Purpose"
              value={form.purpose}
              onChange={(e) =>
                setForm((p) => ({ ...p, purpose: e.target.value }))
              }
              placeholder="e.g. Intro meeting, rate discussion"
              required
              disabled={busy}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DateTimeField
                id="visit-when"
                label="Date and time"
                value={form.plannedAt}
                onChange={(e) =>
                  setForm((p) => ({ ...p, plannedAt: e.target.value }))
                }
                disabled={busy}
                required
              />
              <Input
                id="visit-location"
                label="Location"
                value={form.location}
                onChange={(e) =>
                  setForm((p) => ({ ...p, location: e.target.value }))
                }
                placeholder="City / office"
                required
                disabled={busy}
              />
            </div>
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
              loadingText="Planning…"
              iconBefore={<Plus className="h-4 w-4" />}
            >
              Plan Visit
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

/* ── Complete — outcome becomes the outreach touch (RULE-VP-02) ── */
const CompleteDialog = ({ busy, visit, onClose, onSubmit }) => {
  const [form, setForm] = useState({
    outcome: "positive",
    notes: "",
    followUpAt: "",
  });
  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              outcome: form.outcome,
              notes: form.notes || undefined,
              followUpAt: form.followUpAt || undefined,
            });
          }}
        >
          <ModalHeader
            title="Complete Visit"
            onClose={() => !busy && onClose()}
          />

          <ModalBody className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {visit.purpose} · {visit.targetCompany}
            </p>
            <Select
              label="Outcome"
              value={form.outcome}
              onValueChange={(v) => setForm((p) => ({ ...p, outcome: v }))}
              options={OUTCOME_OPTIONS}
              disabled={busy}
            />
            <Input
              id="complete-notes"
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="What happened?"
              disabled={busy}
            />
            <DateTimeField
              id="complete-followup"
              label="Next follow-up (optional)"
              value={form.followUpAt}
              onChange={(e) =>
                setForm((p) => ({ ...p, followUpAt: e.target.value }))
              }
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
              loadingText="Completing…"
              iconBefore={<CheckCircle2 className="h-4 w-4" />}
            >
              Complete
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

const CancelDialog = ({ busy, onClose, onSubmit }) => {
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
          <ModalHeader title="Cancel Visit" onClose={() => !busy && onClose()} />
          <ModalBody>
            <Input
              id="cancel-reason"
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is the visit not going ahead?"
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
              loadingText="Cancelling…"
            >
              Cancel Visit
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

const RescheduleDialog = ({ busy, onClose, onSubmit }) => {
  const [when, setWhen] = useState("");
  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!when) return toast.error("Pick a new date and time");
            onSubmit(when);
          }}
        >
          <ModalHeader
            title="Reschedule Visit"
            onClose={() => !busy && onClose()}
          />
          <ModalBody>
            <DateTimeField
              id="resched-when"
              label="New date and time"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              disabled={busy}
              required
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
              disabled={busy}
              loading={busy}
              loadingText="Rescheduling…"
            >
              Reschedule
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

export default VisitsListPage;
