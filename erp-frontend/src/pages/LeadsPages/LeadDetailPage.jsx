import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  User,
  PhoneCall,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ArrowRightCircle,
  History,
} from "lucide-react";
import {
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
  Tooltip,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import * as leadService from "@/services/leadService";
import { useLeadStore } from "@/store/leadStore";
import { useTopicRefresh } from "@/lib/useTopicRefresh";
import { leadTopic, TOPICS } from "@/lib/topics";
import {
  LeadStatusBadge,
  LeadSourceBadge,
  OutreachOutcomeBadge,
} from "./LeadComponents/leadBadges";
import {
  LEAD_STATUS_LABELS,
  OUTREACH_TYPE_LABELS,
  OUTREACH_OUTCOME_LABELS,
} from "./LeadComponents/leadLabels";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "Not set");

/** One 36px baseline across the action bar. */
const ACTION_BTN = "h-9 px-3";

const TYPE_OPTIONS = Object.entries(OUTREACH_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);
const OUTCOME_OPTIONS = Object.entries(OUTREACH_OUTCOME_LABELS).map(
  ([value, label]) => ({ value, label }),
);

/**
 * A follow-up carries a time as well as a date, and @neuctra/ui has no datetime control
 * (DatePicker is date-only). A native input keeps the stored value intact rather than
 * flattening it to midnight; the token classes give it the same surface as the Input
 * fields beside it.
 */
const DateTimeField = ({ id, label, value, onChange, disabled }) => (
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
      className="h-10 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    />
  </div>
);

/** A titled panel whose rows run edge to edge under its header. */
const FeedCard = ({ icon, title, children }) => (
  <Card padding="none" className="overflow-hidden">
    <CardBody>
      <div className="flex items-center gap-2 border-b border-border bg-accent px-4 py-3 text-sm font-semibold">
        {icon} {title}
      </div>
      <div className="max-h-80 divide-y divide-border overflow-y-auto">
        {children}
      </div>
    </CardBody>
  </Card>
);

/**
 * LeadDetailPage — drives the lead machine (WORKFLOW §2):
 * outreach advances new→contacted; qualify needs a non-negative touch
 * (RULE-LD-02); lost needs a reason (RULE-LD-06); lost reopens (RULE-LD-04);
 * qualified converts in one transaction (RULE-LD-05).
 */
const LeadDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const { transitionLead, reopenLead, logOutreach, convertLead } =
    useLeadStore();
  const [lead, setLead] = useState(null);
  const [busy, setBusy] = useState(false);
  // Which lead the state in `lead` belongs to. Adjusting it during render (React's
  // documented adjust-state-on-prop-change pattern) means navigating to another lead
  // blanks the stale one immediately, without a setState inside an effect.
  const [loadedId, setLoadedId] = useState(id);
  if (loadedId !== id) {
    setLoadedId(id);
    setLead(null);
  }
  // Derived, so a BACKGROUND refresh can never replace the page with a spinner.
  const loading = lead === null;
  const [dialog, setDialog] = useState(null); // 'outreach' | 'lost' | 'reopen' | 'convert' | null

  // `isCurrent` is the stale guard: without it a slow response for the previous lead can
  // land after navigating to another one, and a response arriving after unmount warns.
  const loadLead = useCallback(
    async ({ isCurrent } = {}) => {
      const ok = isCurrent ?? (() => true);
      try {
        const res = await leadService.getLead(id);
        if (ok()) setLead(res.data);
      } catch (err) {
        if (!ok()) return;
        toast.error(err?.message || "Lead not found");
        navigate("/admin/leads");
      }
    },
    [id, navigate],
  );

  // Refresh when this lead or the lead list changes — including from another user.
  const { run: reloadLead } = useTopicRefresh(
    [leadTopic(id), TOPICS.LEADS],
    loadLead,
  );

  useEffect(() => {
    reloadLead();
  }, [id, reloadLead]);

  // Mutations go through the store so the LIST hears about them: this page used to
  // refresh only its own detail, so qualifying or losing a lead and pressing Back showed
  // the old status until a reload.
  const act = async (fn, successMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(successMsg || res?.message);
      setDialog(null);
      await reloadLead();
      return res;
    } catch (err) {
      toast.error(err?.message || "Couldn't update the lead");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !lead) {
    return (
      <div className="space-y-5">
        <Skeleton variant="rectangular" height={72} />
        <Skeleton variant="rectangular" height={120} />
        <Skeleton variant="rectangular" height={240} />
        <span className="sr-only">Loading lead…</span>
      </div>
    );
  }

  const isOpen = ["new", "contacted", "qualified"].includes(lead.status);
  const hasPositiveTouch = lead.outreach?.some((o) =>
    ["positive", "neutral"].includes(o.outcome),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/admin/leads"
            aria-label="Back to leads"
            className="rounded-md border border-border p-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold leading-none text-foreground">
                {lead.referenceNo}
              </h1>
              <LeadStatusBadge status={lead.status} />
              <LeadSourceBadge source={lead.source} />
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Owner: {lead.ownerName}
            </p>
          </div>
        </div>

        {/* Machine actions */}
        <div className="flex flex-wrap items-center gap-2">
          {isOpen && (
            <Button
              size="sm"
              variant="outline"
              className={ACTION_BTN}
              onClick={() => setDialog("outreach")}
              iconBefore={<PhoneCall className="h-4 w-4" />}
            >
              Log Outreach
            </Button>
          )}

          {lead.status === "contacted" &&
            /* RULE-LD-02: qualifying needs at least one non-negative touch, so the
               reason the button is dead belongs on the button itself. */
            (hasPositiveTouch ? (
              <Button
                size="sm"
                className={ACTION_BTN}
                disabled={busy}
                onClick={() =>
                  act(
                    () => transitionLead(lead.id, { toStatus: "qualified" }),
                    "Lead qualified",
                  )
                }
                iconBefore={<CheckCircle2 className="h-4 w-4" />}
              >
                Qualify
              </Button>
            ) : (
              <Tooltip content="Needs at least one non-negative outreach first (RULE-LD-02)">
                <span className="inline-flex">
                  <Button
                    size="sm"
                    className={ACTION_BTN}
                    disabled
                    iconBefore={<CheckCircle2 className="h-4 w-4" />}
                  >
                    Qualify
                  </Button>
                </span>
              </Tooltip>
            ))}

          {lead.status === "qualified" && (
            <>
              <Button
                size="sm"
                className={ACTION_BTN}
                onClick={() => setDialog("convert")}
                iconBefore={<ArrowRightCircle className="h-4 w-4" />}
              >
                Convert to Customer
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={ACTION_BTN}
                disabled={busy}
                onClick={() =>
                  act(
                    () =>
                      transitionLead(lead.id, {
                        toStatus: "contacted",
                        notes: "De-qualified, needs more work",
                      }),
                    "Moved back to contacted",
                  )
                }
              >
                De-qualify
              </Button>
            </>
          )}

          {/* Neuctra has no destructive-outline variant, and a solid red button here
              would outweigh the primary action. The token text colour carries it. */}
          {isOpen && (
            <Button
              size="sm"
              variant="outline"
              className={`${ACTION_BTN} text-destructive`}
              onClick={() => setDialog("lost")}
              iconBefore={<XCircle className="h-4 w-4" />}
            >
              Mark Lost
            </Button>
          )}

          {lead.status === "lost" && (
            <Button
              size="sm"
              variant="outline"
              className={ACTION_BTN}
              onClick={() => setDialog("reopen")}
              iconBefore={<RotateCcw className="h-4 w-4" />}
            >
              Reopen
            </Button>
          )}

          {lead.status === "converted" && lead.convertedToCustomerId && (
            <Link to="/admin/customers">
              <Button
                size="sm"
                className={ACTION_BTN}
                iconBefore={<ArrowRightCircle className="h-4 w-4" />}
              >
                View Customers
              </Button>
            </Link>
          )}
        </div>
      </div>

      {lead.status === "lost" && lead.lostReason && (
        <Callout type="error" title="This lead was marked lost">
          {lead.lostReason}
        </Callout>
      )}

      {/* Company + Contact */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card padding="md">
          <CardBody className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Building2 className="h-4 w-4 text-primary" /> Company
            </div>
            <p className="font-medium">{lead.company?.name ?? "Not set"}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {[lead.company?.city, lead.company?.country]
                .filter(Boolean)
                .join(", ") || "No location"}
            </p>
          </CardBody>
        </Card>

        <Card padding="md">
          <CardBody className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <User className="h-4 w-4 text-primary" /> Contact
            </div>
            <p className="font-medium">
              {lead.contact?.name ?? "Not set"}
              {lead.contact?.position ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {lead.contact.position}
                </span>
              ) : null}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {[lead.contact?.email, lead.contact?.phone]
                .filter(Boolean)
                .join(" · ") || "No contact details"}
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Outreach + History */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FeedCard
          icon={<PhoneCall className="h-4 w-4 text-primary" />}
          title={`Outreach (${lead.outreach?.length ?? 0})`}
        >
          {(lead.outreach ?? []).map((o) => (
            <div key={o.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {OUTREACH_TYPE_LABELS[o.type] ?? o.type}
                  <OutreachOutcomeBadge outcome={o.outcome} />
                </span>
                <span className="text-xs text-muted-foreground">
                  {fmt(o.occurredAt)}
                </span>
              </div>
              {o.notes && (
                <p className="mt-1 leading-relaxed text-muted-foreground">
                  {o.notes}
                </p>
              )}
              {o.followUpAt && (
                <p className="mt-1 text-xs text-primary">
                  Follow-up: {fmt(o.followUpAt)}
                </p>
              )}
            </div>
          ))}

          {(lead.outreach ?? []).length === 0 && (
            <EmptyState
              size="sm"
              icon={<PhoneCall className="h-5 w-5" />}
              title="No outreach yet"
              description="The first logged touch moves this lead to Contacted."
            />
          )}
        </FeedCard>

        <FeedCard
          icon={<History className="h-4 w-4 text-primary" />}
          title="Status History"
        >
          {(lead.statusHistory ?? [])
            .slice()
            .reverse()
            .map((h) => (
              <div key={h.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {h.fromStatus
                      ? `${LEAD_STATUS_LABELS[h.fromStatus]} → `
                      : ""}
                    {LEAD_STATUS_LABELS[h.toStatus]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {fmt(h.createdAt)}
                  </span>
                </div>
                {h.notes && (
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    {h.notes}
                  </p>
                )}
              </div>
            ))}

          {(lead.statusHistory ?? []).length === 0 && (
            <EmptyState
              size="sm"
              icon={<History className="h-5 w-5" />}
              title="Nothing recorded yet"
              description="Every status change lands here with who made it and why."
            />
          )}
        </FeedCard>
      </div>

      {/* ── Dialogs ── */}
      {dialog === "outreach" && (
        <OutreachDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(payload) =>
            act(() => logOutreach(lead.id, payload), "Outreach logged")
          }
        />
      )}
      {dialog === "lost" && (
        <ReasonDialog
          busy={busy}
          title="Mark Lead Lost"
          description="A loss reason is mandatory. The conversion report is built on these (RULE-LD-06)."
          confirmLabel="Mark Lost"
          destructive
          onClose={() => setDialog(null)}
          onSubmit={(reason) =>
            act(
              () => transitionLead(lead.id, { toStatus: "lost", reason }),
              "Lead marked lost",
            )
          }
        />
      )}
      {dialog === "reopen" && (
        <ReasonDialog
          busy={busy}
          title="Reopen Lead"
          description="Reopening moves the lead back to Contacted (RULE-LD-04)."
          confirmLabel="Reopen"
          onClose={() => setDialog(null)}
          onSubmit={(reason) =>
            act(() => reopenLead(lead.id, reason), "Lead reopened")
          }
        />
      )}
      {dialog === "convert" && (
        <ConvertDialog
          busy={busy}
          companyName={lead.company?.name}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const res = await act(
              () => convertLead(lead.id),
              "Lead converted to customer",
            );
            if (res) navigate("/admin/customers");
          }}
        />
      )}
    </div>
  );
};

/* ── Log Outreach dialog ── */
const OutreachDialog = ({ busy, onClose, onSubmit }) => {
  const [form, setForm] = useState({
    type: "call",
    outcome: "neutral",
    notes: "",
    followUpAt: "",
  });

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      type: form.type,
      outcome: form.outcome,
      notes: form.notes || undefined,
      followUpAt: form.followUpAt || undefined,
    });
  };

  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-md">
        <form onSubmit={submit}>
          <ModalHeader title="Log Outreach" onClose={() => !busy && onClose()} />

          <ModalBody className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              The first touch on a new lead moves it to Contacted.
            </p>
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
            <Input
              id="outreach-notes"
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Optional"
              disabled={busy}
            />
            <DateTimeField
              id="outreach-followup"
              label="Follow-up (optional)"
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
              loadingText="Logging…"
            >
              Log
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

/* ── Generic reason dialog (lost / reopen) ── */
const ReasonDialog = ({
  busy,
  title,
  description,
  confirmLabel,
  destructive,
  onClose,
  onSubmit,
}) => {
  const [reason, setReason] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (reason.trim().length < 3) return toast.error("A reason is required");
    onSubmit(reason.trim());
    setReason("");
  };
  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-md">
        <form onSubmit={submit}>
          <ModalHeader title={title} onClose={() => !busy && onClose()} />
          <ModalBody className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
            <Input
              id="reason-input"
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
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
              variant={destructive ? "destructive" : "default"}
              disabled={busy}
              loading={busy}
              loadingText="Working…"
            >
              {confirmLabel}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

/* ── Convert confirm dialog ── */
const ConvertDialog = ({ busy, companyName, onClose, onConfirm }) => (
  <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
    <ModalContent maxWidth="max-w-md">
      <ModalHeader title="Convert to Customer" onClose={() => !busy && onClose()} />
      <ModalBody>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Creates a customer record (CST-…) for{" "}
          <b className="text-foreground">{companyName}</b> in one transaction,
          linked to the company and contact created with this lead. The lead
          becomes read-only.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          disabled={busy}
          loading={busy}
          loadingText="Converting…"
          iconBefore={<ArrowRightCircle className="h-4 w-4" />}
        >
          Convert
        </Button>
      </ModalFooter>
    </ModalContent>
  </Modal>
);

export default LeadDetailPage;
