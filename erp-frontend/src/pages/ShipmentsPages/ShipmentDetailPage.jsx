import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  RotateCcw,
  Pause,
  Play,
  Ban,
  Lock,
  MessageSquare,
  Receipt,
  CalendarClock,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Upload,
  Plus,
  FileText,
  Download,
  MapPin,
  Trash2,
  ListChecks,
  UserPlus,
  UserMinus,
  UserCheck,
} from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  DatePicker,
  EmptyState,
  FileUpload,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Progress,
  Select,
  Skeleton,
  Spinner,
  Stepper,
  Textarea,
  Tooltip,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { hasAnyRole, isManagement } from "@/lib/roles";
import { useShipmentDetailStore } from "@/store/shipmentDetailStore";
import { useDocumentStore } from "@/store/documentStore";
import { useWorkflowStore } from "@/store/workflowStore";
import * as documentService from "@/services/documentService";
import * as vendorService from "@/services/vendorService";
import { DOC_TYPE_OPTIONS } from "@/services/documentService";
import { INVOICE_KIND_LABELS } from "@/services/financeService";
import {
  SHIPMENT_STATUS_LABELS,
  labelForService,
  paymentStateOf,
  DEFAULT_CURRENCY,
  routeOf,
} from "@/lib/catalog";
import { joinRoom } from "@/lib/socket";
import DocumentsPanel from "@/components/DocumentsPanel";

const EMPTY = [];

const prettyStep = (code) =>
  code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const money = (n, ccy) =>
  `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Not set";
/** Steps are confirmed to the minute, and on a busy day the minute is the useful part. */
const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
const kb = (n) =>
  n > 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * Local YYYY-MM-DD. `toISOString()` converts to UTC first, which in PKT (UTC+5) moves
 * every date back a day — an ETD picked as the 15th would be sent as the 14th.
 */
const toISODate = (d) => {
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Status chips. @neuctra/ui's Badge is primary-coloured in all three variants and
 * exposes no colour prop, so the semantic ramp comes through `className` — its `cn`
 * runs tailwind-merge with the consumer class last, so these replace the built-in
 * `bg-primary/10 text-primary` cleanly rather than fighting it.
 */
const CHIP = "whitespace-nowrap border text-xs";
const TONE = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-info/30 bg-info/10 text-info",
  neutral: "border-border bg-muted text-muted-foreground",
};
/**
 * Payment state ramp. Deliberately local rather than `PAYMENT_STATE_CLASS` from
 * lib/catalog: that map is still written in raw palette colours (green-50/amber/red),
 * which the theme tokens replace here.
 */
const PAY_TONE = {
  paid: TONE.success,
  part_paid: TONE.warning,
  unpaid: TONE.danger,
  void: `${TONE.neutral} line-through`,
};

/**
 * @neuctra/ui labels its own fields but exports no standalone Label, so headings for
 * grouped controls use its label styling (same helper as GiveQuoteDialog).
 */
const FieldLabel = ({ children }) => (
  <span className="mb-1.5 block text-[13px] font-medium leading-none text-foreground">
    {children}
  </span>
);

/**
 * Neuctra's Input does not extend the native input attributes, so `autoFocus` is not a
 * prop. It does forward a ref, which is what this focuses on mount instead.
 */
const useAutoFocus = () => {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
};

const HOLD_TYPE_OPTIONS = [
  "customs_hold",
  "payment_hold",
  "documentation_hold",
  "weather_hold",
  "customer_request",
  "other",
].map((t) => ({ value: t, label: prettyStep(t) }));

/**
 * One cell of the summary grid. The hairlines between cells come from the parent's
 * `gap-px` over a border-coloured background rather than a border on every cell —
 * no last-child resets, and it stays correct however the grid reflows.
 * Renders nothing when there is no value, so the grid never shows an empty cell.
 */
const Fact = ({ label, value, icon: Icon }) => {
  if (!value) return null;
  return (
    <div className="bg-card p-3 sm:p-4">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />} {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
};

const DEPT_LABELS = {
  operations: "Operations",
  compliance: "Compliance",
  transport: "Transport",
  finance: "Finance",
  hr: "HR",
  sales: "Sales",
  management: "Management",
};

// Role → department (RULE-SH-04 ownership). Management roles deliberately map to
// null — they oversee but cannot complete steps themselves.
const DEPT_BY_ROLE = {
  ops_manager: "operations",
  ops_exec: "operations",
  compliance_manager: "compliance",
  compliance_exec: "compliance",
  transport_manager: "transport",
  transport_exec: "transport",
  accounts: "finance",
  hr: "hr",
  asm: "sales",
  bdo: "sales",
};
// A multi-role employee owns steps for every department their roles map to.
const departmentsForUser = (user) => {
  const roles = user?.roles?.length
    ? user.roles
    : user?.role
      ? [user.role]
      : [];
  return [...new Set(roles.map((r) => DEPT_BY_ROLE[r]).filter(Boolean))];
};

const ShipmentDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);

  const [vendors, setVendors] = useState([]);
  const [expandedId, setExpandedId] = useState(null); // which step's panel is open
  const [dialog, setDialog] = useState(null); // { kind, payload }

  // Job P&L is management/finance reporting, not day-to-day step work.
  const canViewPnl = hasPermission("report.read");

  // The shipment aggregate and every write against it (steps, milestones, exception
  // lifecycle, invoices) live in the store, so each write can declare the topics it
  // dirties and the rest of the app stops needing a reload. See shipmentDetailStore.
  const detail = useShipmentDetailStore();
  const { shipment, refreshing, error } = detail;

  // Documents are read from the store the panel below also uses. They used to be a
  // second copy in this component's state, which is why attaching a required document
  // in that panel left the Complete button disabled until the page was reloaded.
  const docStore = useDocumentStore();
  const docsAreMine =
    docStore.ownerType === "shipment" && docStore.ownerId === id;
  const documents = docsAreMine ? docStore.documents : EMPTY;
  const checklist = docsAreMine ? docStore.checklist : EMPTY;

  // One page-wide "a write is in flight" flag. Uploads run through documentStore, so
  // without folding it in, the step upload dialog's button would stay live mid-upload.
  const busy = detail.busy || docStore.busy;

  // Admin-managed docType vocabulary (ADR-051). Called with NO selector on purpose:
  // labelForDocType is a store method whose identity never changes, so a component
  // that selected only it would never re-render when the vocabulary hydrates and
  // every label here would stay a raw code. The bare whole-store subscription is what
  // makes these labels live.
  const { labelForDocType, fetchDocTypes } = useWorkflowStore();

  useEffect(() => {
    fetchDocTypes();
  }, [fetchDocTypes]);

  // Vendors for the payable-invoice dialog. Best-effort.
  useEffect(() => {
    if (!hasPermission("invoice.create")) return;
    vendorService
      .listVendors({ isActive: true })
      .then((r) => setVendors(r.data || []))
      .catch(() => {});
  }, [hasPermission]);

  useEffect(() => {
    detail.fetch(id, { canViewPnl });
    // The page kicks off the document read rather than leaving it to <DocumentsPanel>,
    // which renders below the `if (!shipment) return null` guard: if the panel owned
    // the first fetch, the stepper would paint one pass with an empty checklist —
    // every required badge amber and Complete disabled — before correcting itself.
    useDocumentStore.getState().fetch("shipment", id, { withRequired: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store actions are stable
  }, [id, canViewPnl]);

  // Live tracking (EDGE-T-05). Joining the room is all this page needs to do: the
  // relay's `data:changed` fan-out carries the `shipment:{id}` topic, and
  // RealtimeBridge maps it onto both stores above. Nothing here has to know which
  // event names exist, and one completion no longer triggers three full reloads.
  useEffect(() => joinRoom("shipment", id), [id]);

  /**
   * Run a store mutation, toast, close the dialog. The store owns the refetch and the
   * cross-screen invalidation, so this is only presentation.
   */
  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      setDialog(null);
    } catch (err) {
      toast.error(err?.message || "Action failed");
    }
  };

  // Skeletons until the first read lands. `loading` is false for the frame between
  // mount and the fetch effect, and false again for every BACKGROUND refresh — which
  // is the point: an auto-refresh must never replace the screen with a spinner.
  if (!shipment && !error)
    return (
      <div className="space-y-5">
        <Skeleton variant="rectangular" height={160} />
        <Skeleton variant="rectangular" height={256} />
        <span className="sr-only">Loading shipment…</span>
      </div>
    );
  if (error && !shipment)
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          iconBefore={<ArrowLeft className="h-4 w-4" />}
          onClick={() => navigate("/admin/shipments")}
        >
          Back to shipments
        </Button>
        <Callout type="error" title="Couldn't load this shipment">
          {error}
        </Callout>
      </div>
    );

  const held = shipment.exceptionState === "on_hold";
  const cancelled = shipment.exceptionState === "cancelled";
  // The order lock (RULE-SH-12) — mirrors lockStateOf() on the server. Settled
  // means every step is confirmed AND every invoice paid; from here the record
  // is history, so the UI stops offering edits instead of letting the API 409.
  const lock = cancelled
    ? "cancelled"
    : ["settled", "closed"].includes(shipment.status)
      ? shipment.status
      : null;
  const locked = !!lock;
  const steps = shipment.otdSteps ?? [];
  const firstPendingDisplayNo = steps.find(
    (s) => s.status === "pending",
  )?.displayNo;
  // The rail's cursor. Once nothing is pending it sits one past the end, which is what
  // makes every dot read as confirmed rather than leaving the last one hanging open.
  const firstPendingIndex = steps.findIndex((s) => s.status === "pending");
  const railActiveIndex =
    firstPendingIndex === -1 ? steps.length : firstPendingIndex;
  /**
   * Stepper derives "done" from position alone: everything before `activeStep`. Nothing
   * can be completed out of order any more, but shipments worked while the manager
   * override existed still carry steps confirmed ahead of their predecessors, and those
   * sit *after* the cursor — so they would silently read as not started. Giving them an
   * explicit tick keeps history honest without fighting the component.
   */
  const railSteps = steps.map((s, i) => ({
    label: s.title ?? prettyStep(s.stepCode),
    description: DEPT_LABELS[s.ownerDepartment] ?? s.ownerDepartment,
    icon:
      s.status === "done" && i > railActiveIndex ? (
        <Check className="h-4 w-4" />
      ) : undefined,
  }));
  const myDepartments = departmentsForUser(user);
  const checklistByStep = Object.fromEntries(
    (checklist ?? []).map((c) => [c.stepCode, c]),
  );
  // Group documents + invoices under the step they belong to (Phase-2 per-step UI).
  const docsByStep = (documents ?? []).reduce((m, d) => {
    if (d.otdStepId) (m[d.otdStepId] ??= []).push(d);
    return m;
  }, {});
  const invoicesByStep = (shipment.invoices ?? []).reduce((m, inv) => {
    if (inv.otdStepId) (m[inv.otdStepId] ??= []).push(inv);
    return m;
  }, {});
  // Ops ownership (2026-09-08) — one ops person runs a shipment. An ops user who is
  // not the owner reads it but writes nothing; other departments are unaffected, and
  // Management oversees without claiming.
  const isOpsUser =
    hasAnyRole(user, ["ops_manager", "ops_exec"]) && !isManagement(user);
  const opsOwned = !isOpsUser || shipment.opsOwnerId === user?.id;
  const unclaimed = !shipment.opsOwnerId;
  const canClaim = hasPermission("shipment.claim") && unclaimed && !locked;
  const canAssign = hasPermission("shipment.assign") && !locked;
  // Every ops write on this screen additionally needs ownership.
  const mayWrite = !locked && opsOwned;
  const canBill = hasPermission("invoice.create") && opsOwned;

  const doneSteps = steps.filter((s) => s.status === "done").length;
  const progressPct = steps.length
    ? Math.round((doneSteps / steps.length) * 100)
    : 0;

  return (
    <div className="space-y-5 pb-10">
      {/*
  Action bar.
  Normal document flow — NOT sticky.
  Controls remain horizontally scrollable on small screens.
*/}
      <div className="-mx-4 px-4">
        <div className="flex min-w-0 items-center gap-3">
          {/* Back */}
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            iconBefore={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate("/admin/shipments")}
          >
            <span className="hidden sm:inline">Shipments</span>
          </Button>

          {/* Shipment reference */}
          <span className="hidden min-w-0 truncate text-sm font-semibold sm:inline">
            {shipment.referenceNo}
          </span>

          {/* Actions */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-x-auto px-1 scrollbar-none">
            {/* Claim — the one primary action on this bar */}
            {canClaim && (
              <Button
                size="sm"
                className="shrink-0"
                disabled={busy}
                iconBefore={<UserPlus className="h-4 w-4" />}
                onClick={() =>
                  act(() => detail.claim(), "This shipment is yours")
                }
              >
                Claim
              </Button>
            )}

            {/* Release */}
            {canAssign && !unclaimed && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={busy}
                iconBefore={<UserMinus className="h-4 w-4" />}
                onClick={() =>
                  act(() => detail.assign(null), "Released back to the pool")
                }
              >
                Release
              </Button>
            )}

            {/* Schedule */}
            {hasPermission("shipment.schedule") && mayWrite && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                iconBefore={<CalendarClock className="h-4 w-4" />}
                onClick={() => setDialog({ kind: "schedule" })}
              >
                <span className="hidden sm:inline">Set schedule</span>
                <span className="sm:hidden">Schedule</span>
              </Button>
            )}

            {/* Chat */}
            {shipment.chatChannelId && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                iconBefore={<MessageSquare className="h-4 w-4" />}
                onClick={() =>
                  navigate("/admin/chat", {
                    state: {
                      channelId: shipment.chatChannelId,
                    },
                  })
                }
              >
                Chat
              </Button>
            )}

            {/* Hold */}
            {!held && mayWrite && hasPermission("shipment.hold") && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                iconBefore={<Pause className="h-4 w-4" />}
                onClick={() => setDialog({ kind: "hold" })}
              >
                Hold
              </Button>
            )}

            {/* Resume */}
            {held && opsOwned && hasPermission("shipment.resume") && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                iconBefore={<Play className="h-4 w-4" />}
                onClick={() => setDialog({ kind: "resume" })}
              >
                Resume
              </Button>
            )}

            {/* Cancel. Neuctra's destructive variant is a solid fill, which would
                outweigh the primary action in a row of outlines — the danger reads
                from the token text colour instead, and the confirm dialog carries
                the full destructive weight. */}
            {mayWrite && hasPermission("shipment.cancel") && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-destructive"
                iconBefore={<Ban className="h-4 w-4" />}
                onClick={() => setDialog({ kind: "cancel" })}
              >
                Cancel
              </Button>
            )}

            {/* Close */}
            {shipment.status === "settled" &&
              opsOwned &&
              hasPermission("shipment.close") && (
                <Button
                  size="sm"
                  className="shrink-0"
                  iconBefore={<Lock className="h-4 w-4" />}
                  onClick={() => act(() => detail.close(), "Shipment closed")}
                  disabled={busy}
                >
                  Close
                </Button>
              )}
          </div>
        </div>
      </div>

      {/* Summary card. `padding="none"` lets the fact grid run edge to edge, so the
          hairlines meet the card border instead of floating inside a gutter. */}
      <Card padding="none" className="overflow-hidden">
        <CardBody>
          <div className="flex flex-col gap-4 border-b border-border p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight text-primary sm:text-2xl">
                  {shipment.referenceNo}
                </h1>
                <Badge
                  variant="outline"
                  size="sm"
                  text={SHIPMENT_STATUS_LABELS[shipment.status]}
                  className={`${CHIP} ${TONE.neutral}`}
                />
                {/* Auto-refresh in progress — a hint, never a barrier: the screen stays
                    usable and keeps the data it already has. */}
                {refreshing && (
                  <Tooltip content="Refreshing">
                    <span className="inline-flex text-muted-foreground">
                      <Spinner size="xs" label="Refreshing" />
                    </span>
                  </Tooltip>
                )}
                {held && (
                  <Badge
                    variant="soft"
                    size="sm"
                    text="On Hold"
                    icon={<Pause className="h-3 w-3" />}
                    className={`${CHIP} ${TONE.warning}`}
                  />
                )}
                {cancelled && (
                  <Badge
                    variant="soft"
                    size="sm"
                    text="Cancelled"
                    icon={<Ban className="h-3 w-3" />}
                    className={`${CHIP} ${TONE.danger}`}
                  />
                )}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {shipment.customerCompany} · {shipment.customerRef}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {/* The package (what was sold) leads; the composed services follow. */}
                {(shipment.services ?? []).map((s) => (
                  <Badge
                    key={s}
                    variant="soft"
                    size="sm"
                    text={labelForService(s)}
                  />
                ))}
              </div>
            </div>

            {/* Progress was invisible before — you had to count ticks down the list. */}
            <div className="w-full shrink-0 rounded-lg border border-border bg-accent p-3 lg:w-64">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Progress
                </span>
                <span className="text-sm font-semibold">
                  {doneSteps}
                  <span className="text-muted-foreground">/{steps.length}</span>
                </span>
              </div>
              <Progress
                className="mt-2"
                value={progressPct}
                label="Steps completed"
                size="sm"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {progressPct}% of steps confirmed
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-5">
            <Fact label="Route" value={routeOf(shipment)} icon={MapPin} />
            <Fact
              label="ETD"
              value={fmtDate(shipment.etd)}
              icon={CalendarClock}
            />
            <Fact
              label="ETA"
              value={fmtDate(shipment.eta)}
              icon={CalendarClock}
            />
            <Fact
              label="Run by"
              value={shipment.opsOwnerName ?? "Nobody yet"}
              icon={UserCheck}
            />
            {/* Import terms — the detention clock and where the empty goes back. Only
                the import package carries them, and both are what the yard asks for. */}
            {shipment.freeDays != null && (
              <Fact
                label="Free days"
                value={String(shipment.freeDays)}
                icon={CalendarClock}
              />
            )}
            {shipment.emptyReturnLocation && (
              <Fact
                label="Empty return"
                value={shipment.emptyReturnLocation}
                icon={MapPin}
              />
            )}
            {shipment.incoterm && (
              <Fact
                label="Incoterm"
                value={shipment.incoterm}
                icon={FileText}
              />
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Ops ownership — who runs this job, and why the buttons are missing. */}
      {!locked && unclaimed && (
        <Callout
          type="warning"
          title="Nobody is running this shipment yet"
          icon={<UserPlus className="h-5 w-5" />}
        >
          Its operations tasks are sitting in the queue. Claim it to take the
          job on. From then on its steps, schedule, documents and costs are
          yours to work.
        </Callout>
      )}
      {!locked && !unclaimed && !opsOwned && (
        <Callout
          type="neutral"
          title={`${shipment.opsOwnerName ?? "Another ops user"} is running this shipment`}
          icon={<UserCheck className="h-5 w-5" />}
        >
          You can see everything here, but only the owner records progress on
          it. Management can reassign it.
        </Callout>
      )}

      {/* Order lock (RULE-SH-12) — say plainly why nothing can be edited */}
      {locked && (
        <Callout
          type={lock === "cancelled" ? "error" : "success"}
          title={
            lock === "cancelled"
              ? "This order was cancelled"
              : "This order is locked"
          }
          icon={<Lock className="h-5 w-5" />}
        >
          {lock === "cancelled"
            ? "It stays on record for reporting, but nothing further can be recorded against it."
            : lock === "closed"
              ? "Every step was confirmed, every invoice paid, and Management has filed it. It is now a read-only record."
              : "Every step is confirmed and every invoice is paid. Steps, documents, schedule, milestones and payments can no longer change. Only closing it is left."}
        </Callout>
      )}

      {/* OTD stepper */}
      <Card padding="none" className="overflow-hidden">
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-accent px-4 py-3 sm:px-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <ListChecks className="h-4 w-4 text-primary" /> Order to Delivery
            </h2>
            <span className="text-xs text-muted-foreground">
              {steps.length} steps on this path
            </span>
          </div>

          {/* The whole path at a glance. Stepper scrolls the active step into view on
              its own and only makes CONFIRMED dots clickable, so this is an overview
              plus a way back to finished work; the list below stays the surface where
              every step is actually opened and worked. */}
          {steps.length > 0 && (
            <div className="border-b border-border px-4 py-4 sm:px-5">
              <Stepper
                size="sm"
                steps={railSteps}
                activeStep={railActiveIndex}
                onStepClick={(i) => setExpandedId(steps[i].id)}
              />
            </div>
          )}

          <ol className="divide-y divide-border">
            {steps.map((step) => {
              const done = step.status === "done";
              const isNext = step.displayNo === firstPendingDisplayNo;
              const ownedByMe =
                myDepartments.includes(step.ownerDepartment) && opsOwned;
              const docEntry = checklistByStep[step.stepCode];
              const missingDocs = !done && (docEntry?.missing?.length ?? 0) > 0;
              // Attached but not signed off — a different job from "not attached", and
              // it blocks the step just the same (the server refuses either way).
              const awaitingVerification =
                !done && (docEntry?.unverified?.length ?? 0) > 0;
              // RULE-SH-13 — a step whose checklist still has required items open
              // cannot complete, and a force override does not bypass it (it is the
              // work itself, not a sequence question).
              const openActions = !done
                ? (step.actionSummary?.blocking ?? 0)
                : 0;
              const blocked =
                !ownedByMe ||
                missingDocs ||
                awaitingVerification ||
                openActions > 0;
              const isOpen = expandedId === step.id;
              return (
                <li
                  key={step.id}
                  className={`relative transition-colors ${isOpen ? "bg-accent/50" : ""}`}
                >
                  {/* Left accent stripe: the step's state readable in peripheral
                      vision, without spending a column on it. */}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 w-1 ${done ? "bg-success" : isNext ? "bg-primary" : "bg-transparent"}`}
                  />

                  {/* Stacks on a phone and goes side-by-side from `sm`, so the title
                      and the Complete button stop competing for one cramped row. */}
                  <div className="flex flex-col gap-3 p-3 pl-4 sm:flex-row sm:items-start sm:gap-3 sm:p-4 sm:pl-5">
                    {/* The whole title block toggles the panel — a proper button, so
                        it is keyboard-reachable and gives a big touch target, instead
                        of a 16px chevron being the only way in. */}
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setExpandedId(isOpen ? null : step.id)}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {done ? (
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                      ) : (
                        <Circle
                          className={`mt-0.5 h-5 w-5 shrink-0 ${isNext ? "text-primary" : "text-muted-foreground/40"}`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p
                            className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}
                          >
                            {step.displayNo}.{" "}
                            {step.title ?? prettyStep(step.stepCode)}
                          </p>
                          {isNext && !done && (
                            <Badge text="Next" size="sm" className="shrink-0" />
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {DEPT_LABELS[step.ownerDepartment] ??
                            step.ownerDepartment}
                          {step.forced ? " · forced" : ""}
                          {step.actionSummary && (
                            <>
                              {" · "}
                              <span
                                className={
                                  openActions > 0
                                    ? "font-medium normal-case text-warning"
                                    : "normal-case"
                                }
                              >
                                checklist {step.actionSummary.done}/
                                {step.actionSummary.total}
                              </span>
                            </>
                          )}
                        </p>
                        {(docEntry?.required?.length ?? 0) > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {docEntry.required.map((docType) => {
                              const missing = (docEntry.missing ?? []).includes(
                                docType,
                              );
                              return (
                                <Badge
                                  key={docType}
                                  variant="soft"
                                  size="sm"
                                  text={labelForDocType(docType)}
                                  className={`${CHIP} ${missing ? TONE.warning : TONE.success}`}
                                />
                              );
                            })}
                          </div>
                        )}
                        {!done && isNext && !ownedByMe && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Owned by{" "}
                            {DEPT_LABELS[step.ownerDepartment] ??
                              step.ownerDepartment}
                          </p>
                        )}
                        {!done && missingDocs && (ownedByMe || isNext) && (
                          <p className="mt-1 text-[11px] text-warning">
                            Attach:{" "}
                            {docEntry.missing
                              .map((d) => labelForDocType(d))
                              .join(", ")}
                          </p>
                        )}
                        {/* On file but not signed off — names the other half of the
                            gate so nobody hunts for a document already attached. */}
                        {!done &&
                          awaitingVerification &&
                          (ownedByMe || isNext) && (
                            <p className="mt-1 text-[11px] text-warning">
                              Verify:{" "}
                              {docEntry.unverified
                                .map((d) => labelForDocType(d))
                                .join(", ")}
                            </p>
                          )}
                        {!done && openActions > 0 && (ownedByMe || isNext) && (
                          <p className="mt-1 text-[11px] text-warning">
                            {openActions} checklist item
                            {openActions > 1 ? "s" : ""} still open. Open the
                            step to work through{" "}
                            {openActions > 1 ? "them" : "it"}.
                          </p>
                        )}
                      </div>
                      <ChevronDown
                        className={`mt-0.5 hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform sm:block ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    {/* Full-width buttons on a phone, natural width from `sm`. */}
                    <div className="flex shrink-0 items-center gap-2 sm:self-start">
                      {!done &&
                        !held &&
                        mayWrite &&
                        hasPermission("shipment.step.complete") &&
                        (isNext ? (
                          <Button
                            size="sm"
                            className="flex-1 sm:flex-none"
                            disabled={busy || blocked}
                            onClick={() =>
                              act(
                                () => detail.completeStep(step.displayNo),
                                "Step completed",
                              )
                            }
                          >
                            {/* Completing order_lock IS the lock — say so on the
                                button. */}
                            {step.stepCode === "order_lock"
                              ? "Lock order"
                              : "Complete"}
                          </Button>
                        ) : (
                          <span className="self-center text-[11px] text-muted-foreground">
                            Waiting for earlier steps
                          </span>
                        ))}
                      {done &&
                        mayWrite &&
                        hasPermission("shipment.step.reopen") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="flex-1 sm:flex-none"
                            iconBefore={<RotateCcw className="h-3.5 w-3.5" />}
                            disabled={busy}
                            onClick={() =>
                              setDialog({
                                kind: "reopen",
                                displayNo: step.displayNo,
                              })
                            }
                          >
                            Reopen
                          </Button>
                        )}
                      {/* The chevron stays on mobile, where the row's own tap target
                          is less obvious than on a pointer device. */}
                      <IconButton
                        variant="ghost"
                        size="sm"
                        className="sm:hidden"
                        aria-label={
                          isOpen ? "Hide step details" : "Show step details"
                        }
                        icon={
                          isOpen ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )
                        }
                        onClick={() => setExpandedId(isOpen ? null : step.id)}
                      />
                    </div>
                  </div>

                  {/* The details drop out of the row like a dropdown: full row width,
                      flush to its edges, sliding down on open. It is mounted only while
                      open — every step keeping a live StepPanel (each with its own notes
                      draft state) just to animate a close is not worth the cost, so the
                      exit is immediate and the entry is animated. */}
                  {isOpen && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-200 motion-reduce:animate-none">
                      <StepPanel
                        step={step}
                        docEntry={docEntry}
                        stepDocs={docsByStep[step.id] ?? []}
                        stepInvoices={invoicesByStep[step.id] ?? []}
                        canBill={canBill}
                        canUpload={hasPermission("document.upload") && mayWrite}
                        canTickActions={
                          hasPermission("shipment.step.complete") &&
                          ownedByMe &&
                          mayWrite &&
                          !held &&
                          !done
                        }
                        canVerify={
                          hasPermission("document.verify") && mayWrite && !held
                        }
                        onVerify={(documentId, status) =>
                          status === "rejected"
                            ? setDialog({ kind: "rejectDoc", documentId })
                            : act(
                                () =>
                                  useDocumentStore
                                    .getState()
                                    .verify(documentId, { status }),
                                "Document verified",
                              )
                        }
                        busy={busy}
                        onToggleAction={(a, next) =>
                          act(
                            () =>
                              detail.setStepAction(
                                step.displayNo,
                                a.actionCode,
                                next,
                              ),
                            next
                              ? `"${a.title}" marked done`
                              : `"${a.title}" reopened`,
                          )
                        }
                        onUpload={(docType) =>
                          setDialog({
                            kind: "stepUpload",
                            stepId: step.id,
                            docType,
                          })
                        }
                        onCreateInvoice={() =>
                          setDialog({
                            kind: "createInvoice",
                            stepId: step.id,
                            stepCode: step.stepCode,
                          })
                        }
                        onDownload={(d) =>
                          documentService.downloadDocument(d.id, d.fileName)
                        }
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {held && (
            <p className="border-t border-border bg-warning/10 px-4 py-3 text-xs text-warning sm:px-5">
              Shipment is on hold. OTD writes are blocked until it resumes.
            </p>
          )}
        </CardBody>
      </Card>

      {/* Documents — legal docs gate OTD step completion (RULE-SH-06). This panel and
          the stepper above now read the SAME store, so attaching a required document
          here re-derives the step gating immediately.
          Deliberately no `onChanged`: documentStore publishes the `shipment:{id}` topic,
          which this page already owns — passing one too would refetch twice. */}
      <DocumentsPanel
        ownerType="shipment"
        ownerId={id}
        showRequired
        locked={locked}
      />

      {/* Dialogs */}
      {dialog?.kind === "hold" && (
        <HoldDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(payload) =>
            act(() => detail.hold(payload), "Shipment held")
          }
        />
      )}
      {dialog?.kind === "resume" && (
        <ReasonDialog
          busy={busy}
          title="Resume shipment"
          label="Resolution notes"
          confirmText="Resume"
          onClose={() => setDialog(null)}
          onSubmit={(notes) =>
            act(() => detail.resume(notes), "Shipment resumed")
          }
        />
      )}
      {dialog?.kind === "cancel" && (
        <ReasonDialog
          busy={busy}
          title="Cancel shipment"
          label="Cancellation reason"
          confirmText="Cancel Shipment"
          destructive
          onClose={() => setDialog(null)}
          onSubmit={(reason) =>
            act(() => detail.cancel(reason), "Shipment cancelled")
          }
        />
      )}
      {dialog?.kind === "schedule" && (
        <ScheduleDialog
          busy={busy}
          etd={shipment.etd}
          eta={shipment.eta}
          onClose={() => setDialog(null)}
          onSubmit={(payload) =>
            act(() => detail.setSchedule(payload), "Schedule updated")
          }
        />
      )}
      {dialog?.kind === "reopen" && (
        <ReasonDialog
          busy={busy}
          title={`Reopen step ${dialog.displayNo}`}
          label="Reopen reason"
          confirmText="Reopen"
          onClose={() => setDialog(null)}
          onSubmit={(reason) =>
            act(
              () => detail.reopenStep(dialog.displayNo, reason),
              "Step reopened",
            )
          }
        />
      )}
      {dialog?.kind === "stepUpload" && (
        <StepUploadDialog
          busy={busy}
          presetDocType={dialog.docType}
          onClose={() => setDialog(null)}
          onSubmit={({ file, docType }) =>
            act(
              () =>
                useDocumentStore.getState().upload({
                  file,
                  docType,
                  otdStepId: dialog.stepId,
                  ownerType: "shipment",
                  ownerId: id,
                }),
              "File uploaded",
            )
          }
        />
      )}
      {dialog?.kind === "rejectDoc" && (
        <ReasonDialog
          busy={busy}
          title="Reject this document"
          label="What is wrong with it? (the customer is told)"
          confirmText="Reject document"
          destructive
          onClose={() => setDialog(null)}
          onSubmit={(note) =>
            act(
              () =>
                useDocumentStore
                  .getState()
                  .verify(dialog.documentId, { status: "rejected", note }),
              "Document rejected. The customer has been told",
            )
          }
        />
      )}
      {dialog?.kind === "createInvoice" && (
        <CreateInvoiceDialog
          busy={busy}
          defaultCurrency={shipment.invoices?.[0]?.currency || DEFAULT_CURRENCY}
          vendors={vendors}
          onClose={() => setDialog(null)}
          onSubmit={(payload) =>
            act(
              () =>
                detail.createInvoice({ ...payload, otdStepId: dialog.stepId }),
              "Invoice drafted",
            )
          }
        />
      )}
    </div>
  );
};

const HoldDialog = ({ busy, onClose, onSubmit }) => {
  const [type, setType] = useState("documentation_hold");
  const [reason, setReason] = useState("");
  const reasonRef = useAutoFocus();
  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length < 3)
              return toast.error("A reason is required");
            onSubmit({ type, reason: reason.trim() });
          }}
        >
          <ModalHeader title="Hold shipment" onClose={() => !busy && onClose()} />
          <ModalBody className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Clocks stop and open tasks freeze; documents and chat stay open.
            </p>
            <Select
              label="Type"
              value={type}
              onValueChange={setType}
              options={HOLD_TYPE_OPTIONS}
              disabled={busy}
            />
            <Input
              ref={reasonRef}
              id="hold-reason"
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
              Back
            </Button>
            <Button
              type="submit"
              disabled={busy}
              loading={busy}
              loadingText="Holding…"
            >
              Hold
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};


const ScheduleDialog = ({ busy, etd, eta, onClose, onSubmit }) => {
  const toDate = (d) => (d ? new Date(d) : null);
  const [etdVal, setEtdVal] = useState(toDate(etd));
  const [etaVal, setEtaVal] = useState(toDate(eta));
  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const payload = {};
            if (etdVal) payload.etd = toISODate(etdVal);
            if (etaVal) payload.eta = toISODate(etaVal);
            if (!etdVal && !etaVal) return toast.error("Set at least one date");
            if (etdVal && etaVal && etaVal < etdVal)
              return toast.error("ETA cannot be before ETD");
            onSubmit(payload);
          }}
        >
          <ModalHeader title="Set schedule" onClose={() => !busy && onClose()} />
          <ModalBody className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Planned departure and arrival dates shown to the customer.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DatePicker
                id="sched-etd"
                label="ETD"
                value={etdVal}
                onChange={setEtdVal}
                placeholder="Not set"
                clearable
                disabled={busy}
              />
              <DatePicker
                id="sched-eta"
                label="ETA"
                value={etaVal}
                onChange={setEtaVal}
                placeholder="Not set"
                clearable
                disabled={busy}
                // An arrival before its own departure is never a real schedule.
                calendarProps={etdVal ? { minDate: etdVal } : undefined}
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
              Back
            </Button>
            <Button
              type="submit"
              disabled={busy}
              loading={busy}
              loadingText="Saving…"
            >
              Save
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

const ReasonDialog = ({
  busy,
  title,
  label,
  confirmText,
  destructive,
  onClose,
  onSubmit,
}) => {
  const [reason, setReason] = useState("");
  const reasonRef = useAutoFocus();
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
          <ModalHeader title={title} onClose={() => !busy && onClose()} />
          <ModalBody>
            <Input
              ref={reasonRef}
              id="reason-input"
              label={label}
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
              Back
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={busy}
              loading={busy}
              loadingText="Working…"
            >
              {confirmText}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

/**
 * One block inside the step panel. Each section is a Card so the panel is scannable
 * rather than five bare headings in one undifferentiated column. The header's layout
 * is CardHeader's own — the icon is passed plain rather than wrapped in a tinted chip,
 * which repeated on every section was decoration rather than information.
 *
 * `meta` is the at-a-glance status (a count, a progress figure); `action` is the button
 * that belongs to the section, kept in the header so it never moves as content grows.
 */
const SectionCard = ({ icon: Icon, title, meta, action, children }) => (
  <Card padding="sm" variant="outline">
    <CardHeader
      title={title}
      icon={Icon ? <Icon className="h-4 w-4" /> : undefined}
      action={
        (meta || action) && (
          <div className="flex shrink-0 items-center gap-2">
            {meta}
            {action}
          </div>
        )
      }
    />
    <CardBody>{children}</CardBody>
  </Card>
);

/* ── The per-step expandable panel: state, checklist, its documents and its billing. ── */
const StepPanel = ({
  step,
  docEntry,
  stepDocs,
  stepInvoices,
  canBill,
  canUpload,
  canTickActions,
  canVerify,
  busy,
  onToggleAction,
  onUpload,
  onCreateInvoice,
  onDownload,
  onVerify,
}) => {
  const actions = step.actions ?? [];
  const manualActions = actions.filter((a) => a.kind !== "document");
  const done = step.status === "done";
  /**
   * `verificationStatus` defaults to `unverified` on EVERY document, so it only means
   * something for a type that actually requires sign-off. Reading the flag off the
   * vocabulary keeps a chip that says "awaiting verification" off the files nobody is
   * ever going to verify. Subscribe to `docTypes` too, not just the lookup: the
   * function's identity never changes, so selecting it alone would never re-render
   * once the vocabulary hydrates.
   */
  const { docTypes, labelForDocType } = useWorkflowStore();
  const needsVerification = (docType) =>
    !!docTypes.find((t) => t.code === docType)?.requiresVerification;

  /**
   * The paperwork this step is gated on, from BOTH sources the server unions in
   * missingRequiredDocs (RULE-SH-06): the step's `document` checklist items, and the
   * template's own `requiredDocTypes` (which `docEntry.required` carries). Reading only
   * the actions would miss a type required by the template alone, and that type would
   * then block completion with nothing on screen offering to attach it.
   */
  const docActions = actions.filter((a) => a.kind === "document" && a.docType);
  const seen = new Set(docActions.map((a) => a.docType));
  const requiredDocs = [
    ...docActions.map((a) => ({
      docType: a.docType,
      documentId: a.documentId ?? null,
      documentName: a.documentName ?? null,
      requiresVerification: a.requiresVerification ?? needsVerification(a.docType),
      verificationStatus: a.verificationStatus ?? null,
      satisfied: a.satisfied,
    })),
    ...(docEntry?.required ?? [])
      .filter((code) => !seen.has(code))
      .map((code) => {
        // No action row to read from, so satisfaction comes off the checklist's own
        // missing/unverified lists, and the file itself off the step's documents.
        const file = stepDocs.find((d) => d.docType === code) ?? null;
        return {
          docType: code,
          documentId: file?.id ?? null,
          documentName: file?.fileName ?? null,
          requiresVerification: needsVerification(code),
          verificationStatus: file?.verificationStatus ?? null,
          satisfied:
            !(docEntry.missing ?? []).includes(code) &&
            !(docEntry.unverified ?? []).includes(code),
        };
      }),
  ].map((d) => ({
    ...d,
    ...(d.satisfied
      ? { stateLabel: "On file", stateTone: TONE.success }
      : d.verificationStatus === "rejected"
        ? { stateLabel: "Rejected", stateTone: TONE.danger }
        : d.documentId
          ? { stateLabel: "Awaiting verification", stateTone: TONE.warning }
          : { stateLabel: "Missing", stateTone: TONE.warning }),
  }));

  return (
    // Flush to the row's own width — no side margins and no `ml-8` indent — so the
    // panel reads as the step opening downwards rather than as a card floating inside
    // it. The card ground plus the top rule is what separates it from the row above.
    <div className="space-y-3 border-t border-border bg-card p-3 text-sm sm:p-4">
      {/* What confirming this step actually means. Authored per step in Workflow admin
          and resolved from the template at read time (ADR-051); it had no home on this
          screen, so the guidance was being written and never shown. */}
      {step.hint && (
        <p className="rounded-md border border-border bg-accent px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {step.hint}
        </p>
      )}

      {/* Where this step stands, in its own words rather than only as a coloured dot. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="soft"
          size="sm"
          text={DEPT_LABELS[step.ownerDepartment] ?? step.ownerDepartment}
          className={`${CHIP} shrink-0 ${TONE.neutral}`}
        />
        <Badge
          variant="soft"
          size="sm"
          text={
            done
              ? step.completedAt
                ? `Confirmed ${fmtDateTime(step.completedAt)}`
                : "Confirmed"
              : "Not confirmed"
          }
          className={`${CHIP} shrink-0 ${done ? TONE.success : TONE.neutral}`}
        />
        {step.forced && (
          <Badge
            variant="soft"
            size="sm"
            text="Forced"
            icon={<ShieldAlert className="h-3 w-3" />}
            className={`${CHIP} shrink-0 ${TONE.warning}`}
          />
        )}
        {step.reopenCount > 0 && (
          <Badge
            variant="soft"
            size="sm"
            text={`Reopened ${step.reopenCount}x`}
            className={`${CHIP} shrink-0 ${TONE.warning}`}
          />
        )}
      </div>

      {/* An override is only accountable if the reason it was given travels with it. */}
      {step.forced && step.forceReason && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Override reason:</span>{" "}
          {step.forceReason}
        </p>
      )}
      {step.notes && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Notes:</span>{" "}
          {step.notes}
        </p>
      )}

      {/* The paperwork this step is gated on (RULE-SH-06), the roadmap §4 register for
          this stage. Its own section rather than buried among the manual ticks: on the
          roadmap path every step but the last two turns on a specific document, so
          "which paper is still missing" is the question this panel exists to answer. */}
      {requiredDocs.length > 0 && (
        <SectionCard
          icon={FileText}
          title="Required documents"
          meta={
            <Badge
              variant="soft"
              size="sm"
              text={`${requiredDocs.filter((d) => d.satisfied).length} of ${requiredDocs.length} on file`}
              className={`${CHIP} ${requiredDocs.every((d) => d.satisfied) ? TONE.success : TONE.warning}`}
            />
          }
        >
          <ul className="space-y-1.5">
            {requiredDocs.map((d) => (
              <li
                key={d.docType}
                className="flex flex-col gap-1.5 rounded-md border border-border bg-accent px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {d.satisfied ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">
                      {labelForDocType(d.docType)}
                    </span>
                    {d.documentName && (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {d.documentName}
                      </span>
                    )}
                  </span>
                </span>

                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    size="sm"
                    text={d.stateLabel}
                    className={`${CHIP} shrink-0 ${d.stateTone}`}
                  />
                  {d.documentId && (
                    <Button
                      variant="link"
                      size="xs"
                      iconBefore={<Download className="h-3 w-3" />}
                      onClick={() =>
                        onDownload({ id: d.documentId, fileName: d.documentName })
                      }
                    >
                      Open
                    </Button>
                  )}
                  {canVerify &&
                    d.requiresVerification &&
                    d.documentId &&
                    d.verificationStatus !== "verified" && (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onVerify(d.documentId, "verified")}
                      >
                        Verify
                      </Button>
                    )}
                  {canUpload && (
                    <Button
                      size="xs"
                      variant="outline"
                      iconBefore={<Upload className="h-3 w-3" />}
                      disabled={busy}
                      onClick={() => onUpload(d.docType)}
                    >
                      {d.documentId ? "Replace" : "Attach"}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Sub-action checklist (ADR-048) — the step's actual work, itemised. Document
          items are lifted out above, so this is what a person confirms by hand. */}
      {manualActions.length > 0 && (
        <SectionCard
          icon={ListChecks}
          title="Checklist"
          meta={
            <Badge
              variant="soft"
              size="sm"
              text={`${step.actionSummary?.done ?? 0} of ${step.actionSummary?.total ?? actions.length} done`}
              className={`${CHIP} ${step.actionSummary?.blocking ? TONE.warning : TONE.success}`}
            />
          }
        >
          <ul className="space-y-1">
            {/* Each row wraps instead of overflowing: a document item can carry a
                status chip, a download link, Verify, Reject and Upload all at once,
                which never fit beside the title on a phone. */}
            {manualActions.map((a) => (
              <li
                key={a.actionCode}
                className="flex flex-col gap-1.5 rounded-md px-1.5 py-1.5 hover:bg-accent/50 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
              >
                <span
                  className={`flex min-w-0 items-center gap-1.5 ${a.satisfied ? "text-success" : "text-muted-foreground"}`}
                >
                  {a.satisfied ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 break-words">{a.title}</span>
                  {!a.required && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      (optional)
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-1 sm:shrink-0 sm:flex-nowrap">
                  {/* A document item is satisfied by the file, never by a tick — so
                      the only action offered is attaching or opening it. */}
                  {a.kind === "document" ? (
                    <>
                      {/* A type that needs a sign-off shows where it stands: a file on
                          its own is not enough to open the gate. */}
                      {a.requiresVerification && a.documentId && (
                        <Badge
                          variant="outline"
                          size="sm"
                          text={
                            a.verificationStatus === "verified"
                              ? "Verified"
                              : a.verificationStatus === "rejected"
                                ? "Rejected"
                                : "Awaiting verification"
                          }
                          className={`${CHIP} ${
                            a.verificationStatus === "verified"
                              ? TONE.success
                              : a.verificationStatus === "rejected"
                                ? TONE.danger
                                : TONE.warning
                          }`}
                        />
                      )}
                      {a.documentId && (
                        <Button
                          variant="link"
                          size="xs"
                          iconBefore={<Download className="h-3 w-3" />}
                          onClick={() =>
                            onDownload({
                              id: a.documentId,
                              fileName: a.documentName,
                            })
                          }
                        >
                          {a.documentName ?? "View"}
                        </Button>
                      )}
                      {/* Ops signs off the signed copy — this is what locks the
                          order. */}
                      {canVerify &&
                        a.requiresVerification &&
                        a.documentId &&
                        a.verificationStatus !== "verified" && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() => onVerify(a.documentId, "verified")}
                          >
                            Verify
                          </Button>
                        )}
                      {canVerify &&
                        a.requiresVerification &&
                        a.documentId &&
                        a.verificationStatus === "unverified" && (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-destructive"
                            disabled={busy}
                            onClick={() => onVerify(a.documentId, "rejected")}
                          >
                            Reject
                          </Button>
                        )}
                      {/* Still unsatisfied and nothing on file, or the last copy was
                          turned down — either way a (new) file is what is needed. */}
                      {!a.satisfied && canUpload && (
                        <Button
                          size="xs"
                          variant="outline"
                          iconBefore={<Upload className="h-3 w-3" />}
                          disabled={busy}
                          onClick={() => onUpload(a.docType)}
                        >
                          Upload
                        </Button>
                      )}
                    </>
                  ) : canTickActions ? (
                    <Button
                      size="xs"
                      variant={a.satisfied ? "ghost" : "outline"}
                      disabled={busy}
                      onClick={() => onToggleAction(a, !a.satisfied)}
                    >
                      {a.satisfied ? "Undo" : "Mark done"}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {step.actionSummary?.blocking > 0 && (
            <p className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
              This step can&apos;t be completed until the{" "}
              {step.actionSummary.blocking} open item
              {step.actionSummary.blocking > 1 ? "s are" : " is"} cleared.
            </p>
          )}
        </SectionCard>
      )}

      {/* Every file attached to this step, not just the proofs. A document filed
          against a step that is neither a checklist item nor a `proof` used to be
          invisible here: on record, gating nothing, and shown nowhere. */}
      <SectionCard
        icon={Upload}
        title="Documents"
        meta={
          stepDocs.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {stepDocs.length}
            </span>
          )
        }
        action={
          canUpload && (
            <Button
              size="xs"
              variant="outline"
              iconBefore={<Plus className="h-3 w-3" />}
              disabled={busy}
              onClick={() => onUpload("proof")}
            >
              Add proof
            </Button>
          )
        }
      >
        {stepDocs.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Upload className="h-5 w-5" />}
            title="No files on this step"
            description="Attach the photos, signed slips or paperwork that evidence it."
          />
        ) : (
          <ul className="space-y-1.5">
            {stepDocs.map((d) => {
              // A rejection is worth surfacing whatever the type says: it means
              // somebody looked at the file and sent it back.
              const showVerification =
                d.verificationStatus === "rejected" ||
                needsVerification(d.docType);
              return (
                <li
                  key={d.id}
                  className="flex flex-col gap-1.5 rounded-md border border-border bg-accent px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs">
                        {d.fileName}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {d.docType ? labelForDocType(d.docType) : "Unfiled"}
                        {d.sizeBytes ? ` · ${kb(d.sizeBytes)}` : ""}
                        {d.createdAt ? ` · ${fmtDate(d.createdAt)}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {showVerification && (
                      <Badge
                        variant="outline"
                        size="sm"
                        text={
                          d.verificationStatus === "verified"
                            ? "Verified"
                            : d.verificationStatus === "rejected"
                              ? "Rejected"
                              : "Awaiting verification"
                        }
                        className={`${CHIP} shrink-0 ${
                          d.verificationStatus === "verified"
                            ? TONE.success
                            : d.verificationStatus === "rejected"
                              ? TONE.danger
                              : TONE.warning
                        }`}
                      />
                    )}
                    {canVerify &&
                      showVerification &&
                      d.verificationStatus !== "verified" && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy}
                          onClick={() => onVerify(d.id, "verified")}
                        >
                          Verify
                        </Button>
                      )}
                    <Button
                      variant="link"
                      size="xs"
                      iconBefore={<Download className="h-3 w-3" />}
                      onClick={() => onDownload(d)}
                    >
                      Download
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* Billing — the single money record on a step */}
      <SectionCard
        icon={Receipt}
        title="Invoices"
        meta={
          stepInvoices.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {stepInvoices.length}
            </span>
          )
        }
        action={
          canBill && (
            <Button
              size="xs"
              variant="outline"
              iconBefore={<Plus className="h-3 w-3" />}
              disabled={busy}
              onClick={onCreateInvoice}
            >
              New
            </Button>
          )
        }
      >
        {stepInvoices.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Receipt className="h-5 w-5" />}
            title="Nothing billed from this step"
            description="Raise a receivable or record what a vendor charged you."
          />
        ) : (
          <ul className="space-y-1.5">
            {stepInvoices.map((inv) => {
              const pay = paymentStateOf(inv);
              return (
                <li
                  key={inv.id}
                  className="space-y-1.5 rounded-md border border-border bg-background px-3 py-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {inv.referenceNo} ·{" "}
                      <span
                        className={
                          inv.kind === "payable"
                            ? "text-warning"
                            : "text-success"
                        }
                      >
                        {INVOICE_KIND_LABELS[inv.kind ?? "receivable"]}
                      </span>
                    </span>
                    <Badge
                      variant="outline"
                      size="sm"
                      text={pay.label}
                      className={`${CHIP} shrink-0 ${PAY_TONE[pay.key] ?? TONE.neutral}`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {money(inv.totalAmount, inv.currency)}
                    </span>
                    {pay.key !== "void" && pay.key !== "paid" && (
                      <span>
                        {money(pay.outstanding, inv.currency)} outstanding
                      </span>
                    )}
                  </div>
                  {(inv.lines ?? []).length > 0 && (
                    <ul className="space-y-0.5 border-t border-border pt-0.5 text-[11px] text-muted-foreground">
                      {inv.lines.map((l) => (
                        <li
                          key={l.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            {l.description}{" "}
                            <span className="opacity-70">
                              ({Number(l.quantity)} ×{" "}
                              {money(l.unitPrice, inv.currency)})
                            </span>
                          </span>
                          <span className="shrink-0">
                            {money(l.amount, inv.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
};

/* ── Upload a document/proof scoped to a step. ── */
const StepUploadDialog = ({ busy, presetDocType, onClose, onSubmit }) => {
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState(presetDocType || "proof");
  // The admin-managed vocabulary (ADR-051), not the static list. `docTypes` must be
  // subscribed to so the picker re-renders once it hydrates.
  const { docTypes, labelForDocType, docTypeOptions } = useWorkflowStore();
  const base = docTypes.length ? docTypeOptions(false) : DOC_TYPE_OPTIONS;
  // A preset that isn't in the vocabulary (an admin-created code, or anything before
  // hydration) would leave the Select with a value and no matching item — rendering
  // EMPTY, so the user cannot see what they are about to upload.
  const options = base.some((o) => o.value === docType)
    ? base
    : [...base, { value: docType, label: labelForDocType(docType) }];
  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return toast.error("Choose a file");
            onSubmit({ file, docType });
          }}
        >
          <ModalHeader title="Upload to step" onClose={() => !busy && onClose()} />
          <ModalBody className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Attach a required document or a proof file to this step.
            </p>
            <div>
              <FieldLabel>File</FieldLabel>
              <FileUpload
                id="su-file"
                disabled={busy}
                onFilesChange={(files) => setFile(files[0] ?? null)}
                onError={(message) => toast.error(message)}
              />
            </div>
            <Select
              label="Type"
              value={docType}
              onValueChange={setDocType}
              options={options}
              searchable
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
              loadingText="Uploading…"
            >
              Upload
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

/* ── Create a payable/receivable invoice from a step. ── */
const CreateInvoiceDialog = ({
  busy,
  defaultCurrency,
  vendors = [],
  onClose,
  onSubmit,
}) => {
  const [kind, setKind] = useState("receivable");
  const [vendorId, setVendorId] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency || DEFAULT_CURRENCY);
  const [lines, setLines] = useState([
    { description: "", quantity: 1, unitPrice: "" },
  ]);
  const setLine = (i, k, v) =>
    setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addLine = () =>
    setLines((p) => [...p, { description: "", quantity: 1, unitPrice: "" }]);
  const removeLine = (i) => setLines((p) => p.filter((_, idx) => idx !== i));
  const total = lines.reduce(
    (s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
    0,
  );

  const vendorOptions = [
    { value: "none", label: "Free text below" },
    ...vendors.map((v) => ({ value: v.id, label: v.name })),
  ];

  const submit = (e) => {
    e.preventDefault();
    if (kind === "payable" && !vendorId && !counterparty.trim())
      return toast.error(
        "A payable needs a vendor or counterparty (who we owe)",
      );
    const clean = lines.filter(
      (l) =>
        l.description.trim() && l.unitPrice !== "" && Number(l.unitPrice) >= 0,
    );
    if (!clean.length)
      return toast.error("Add at least one charge line with a price");
    onSubmit({
      kind,
      vendorId: kind === "payable" && vendorId ? vendorId : undefined,
      counterparty:
        kind === "payable" && !vendorId ? counterparty.trim() : undefined,
      currency,
      lines: clean.map((l, i) => ({
        description: l.description.trim(),
        quantity: Number(l.quantity) || 1,
        unitPrice: Number(l.unitPrice),
        sortOrder: i,
      })),
    });
  };

  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      {/* The body scrolls, the footer stays clear of it — a modal-level scroll leaves
          the last charge line under the footer and past the end of the scroll range. */}
      <ModalContent maxWidth="max-w-2xl" className="flex max-h-[90vh] flex-col">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <ModalHeader
            title="New invoice from step"
            onClose={() => !busy && onClose()}
          />
          <ModalBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Receivable means the customer owes us. Payable means we owe a
              vendor or carrier.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Kind"
                value={kind}
                onValueChange={setKind}
                options={[
                  { value: "receivable", label: "Receivable (owed to us)" },
                  { value: "payable", label: "Payable (we owe)" },
                ]}
                disabled={busy}
              />
              <Input
                id="ci-ccy"
                label="Currency"
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                disabled={busy}
              />
            </div>
            {kind === "payable" && (
              <div className="space-y-2">
                <Select
                  label="Vendor (who we owe)"
                  value={vendorId || "none"}
                  onValueChange={(v) => setVendorId(v === "none" ? "" : v)}
                  options={vendorOptions}
                  placeholder="Select a vendor"
                  searchable
                  disabled={busy}
                />
                {!vendorId && (
                  <Input
                    value={counterparty}
                    onChange={(e) => setCounterparty(e.target.value)}
                    placeholder="e.g. Maersk, ABC Trucking"
                    disabled={busy}
                  />
                )}
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FieldLabel>Charge lines</FieldLabel>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  iconBefore={<Plus className="h-3.5 w-3.5" />}
                  onClick={addLine}
                  disabled={busy}
                >
                  Add line
                </Button>
              </div>
              {/* On a phone the description takes its own row and qty/price/delete
                  share the next; the 12-column layout only kicks in once there is
                  room for it. */}
              {lines.map((l, i) => (
                <div
                  key={i}
                  className="grid grid-cols-12 items-center gap-2 rounded-md border border-border p-2 sm:border-0 sm:p-0"
                >
                  <Input
                    wrapperClassName="col-span-12 sm:col-span-6"
                    placeholder="Description"
                    value={l.description}
                    onChange={(e) => setLine(i, "description", e.target.value)}
                    disabled={busy}
                  />
                  <Input
                    wrapperClassName="col-span-4 sm:col-span-2"
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="Qty"
                    value={String(l.quantity)}
                    onChange={(e) => setLine(i, "quantity", e.target.value)}
                    disabled={busy}
                  />
                  <Input
                    wrapperClassName="col-span-6 sm:col-span-3"
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="Unit price"
                    value={String(l.unitPrice)}
                    onChange={(e) => setLine(i, "unitPrice", e.target.value)}
                    disabled={busy}
                  />
                  <div className="col-span-2 flex justify-center sm:col-span-1">
                    <IconButton
                      variant="ghost"
                      size="sm"
                      aria-label="Remove line"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => removeLine(i)}
                      disabled={lines.length === 1 || busy}
                    />
                  </div>
                </div>
              ))}
              <div className="text-right text-sm font-semibold">
                Total: {money(total, currency)}
              </div>
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
              loadingText="Creating…"
            >
              Create draft
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

export default ShipmentDetailPage;
