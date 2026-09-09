import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  RotateCcw,
  Pause,
  Play,
  Ban,
  Lock,
  Loader2,
  MessageSquare,
  Receipt,
  AlertCircle,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  PAYMENT_STATE_CLASS,
  DEFAULT_CURRENCY,
  routeOf,
} from "@/lib/catalog";
import { joinRoom } from "@/lib/socket";
import DocumentsPanel from "@/components/DocumentsPanel";
import TradeDocumentsPanel from "@/components/shipment/TradeDocumentsPanel";
import TradeLinkDialog from "@/components/shipment/TradeLinkDialog";

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
    : "—";

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
/**
 * One cell of the summary grid. The hairlines between cells come from the parent's
 * `gap-px` over a border-coloured background rather than a border on every cell —
 * no last-child resets, and it stays correct however the grid reflows.
 * Renders nothing when there is no value, so the grid never shows an empty "—" cell.
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

/**
 * A page-level banner. The four tones were previously written out inline at each call
 * site, which is how the amber/green/red palettes drifted apart between them.
 */
const NOTICE_TONES = {
  warning:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
  success:
    "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200",
  danger:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200",
  neutral: "border-border bg-muted/40 text-foreground",
};

const Notice = ({ tone = "neutral", icon: Icon, title, children }) => (
  <div
    className={`flex items-start gap-3 rounded-xl border p-3 sm:p-4 ${NOTICE_TONES[tone] ?? NOTICE_TONES.neutral}`}
  >
    {Icon && (
      <Icon
        className={`mt-0.5 h-5 w-5 shrink-0 ${tone === "neutral" ? "text-muted-foreground" : ""}`}
      />
    )}
    <div className="min-w-0 text-sm">
      <p className="font-semibold">{title}</p>
      <p
        className={`mt-0.5 ${tone === "neutral" ? "text-muted-foreground" : "opacity-90"}`}
      >
        {children}
      </p>
    </div>
  </div>
);

const DEPT_LABELS = {
  operations: "Operations",
  compliance: "Compliance",
  transport: "Transport",
  finance: "Finance",
  hr: "HR",
  sales: "Sales",
  management: "Management",
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

  // Spin until the first read lands. `loading` is false for the frame between mount
  // and the fetch effect, and false again for every BACKGROUND refresh — which is the
  // point: an auto-refresh must never replace the screen with a spinner.
  if (!shipment && !error)
    return (
      <div className="space-y-5">
        <div className="h-40 animate-pulse rounded-2xl border bg-muted/40" />
        <div className="h-64 animate-pulse rounded-2xl border bg-muted/40" />
        <span className="sr-only">Loading shipment…</span>
      </div>
    );
  if (error && !shipment)
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => navigate("/admin/shipments")}
        >
          <ArrowLeft className="h-4 w-4" /> Back to shipments
        </Button>
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
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
      <div className="-mx-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Back */}
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-2 px-2"
            onClick={() => navigate("/admin/shipments")}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Shipments</span>
          </Button>

          {/* Shipment reference */}
          <span className="hidden min-w-0 truncate text-sm font-semibold sm:inline">
            {shipment.referenceNo}
          </span>

          {/* Actions */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-x-auto px-1 scrollbar-none">
            {/* Claim */}
            {canClaim && (
              <Button
                size="sm"
                className="shrink-0 gap-2"
                disabled={busy}
                onClick={() =>
                  act(() => detail.claim(), "This shipment is yours")
                }
              >
                <UserPlus className="h-4 w-4" />
                Claim
              </Button>
            )}

            {/* Release */}
            {canAssign && !unclaimed && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2"
                disabled={busy}
                onClick={() =>
                  act(() => detail.assign(null), "Released back to the pool")
                }
              >
                <UserMinus className="h-4 w-4" />
                Release
              </Button>
            )}

            {/* Schedule */}
            {hasPermission("shipment.schedule") && mayWrite && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2"
                onClick={() => setDialog({ kind: "schedule" })}
              >
                <CalendarClock className="h-4 w-4" />

                <span className="hidden sm:inline">Set schedule</span>

                <span className="sm:hidden">Schedule</span>
              </Button>
            )}

            {/* Chat */}
            {shipment.chatChannelId && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2"
                onClick={() =>
                  navigate("/admin/chat", {
                    state: {
                      channelId: shipment.chatChannelId,
                    },
                  })
                }
              >
                <MessageSquare className="h-4 w-4" />
                Chat
              </Button>
            )}

            {/* Hold */}
            {!held && mayWrite && hasPermission("shipment.hold") && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2"
                onClick={() => setDialog({ kind: "hold" })}
              >
                <Pause className="h-4 w-4" />
                Hold
              </Button>
            )}

            {/* Resume */}
            {held && opsOwned && hasPermission("shipment.resume") && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2"
                onClick={() => setDialog({ kind: "resume" })}
              >
                <Play className="h-4 w-4" />
                Resume
              </Button>
            )}

            {/* Cancel */}
            {mayWrite && hasPermission("shipment.cancel") && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2 text-destructive"
                onClick={() => setDialog({ kind: "cancel" })}
              >
                <Ban className="h-4 w-4" />
                Cancel
              </Button>
            )}

            {/* Close */}
            {shipment.status === "settled" &&
              opsOwned &&
              hasPermission("shipment.close") && (
                <Button
                  size="sm"
                  className="shrink-0 gap-2"
                  onClick={() => act(() => detail.close(), "Shipment closed")}
                  disabled={busy}
                >
                  <Lock className="h-4 w-4" />
                  Close
                </Button>
              )}
          </div>
        </div>
      </div>

      {/* Summary card. The same facts as before, but on a responsive grid instead of
          seven stacked one-line paragraphs — scannable at a glance and it reflows to
          two columns on a phone rather than becoming a tall ribbon of grey text. */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-primary sm:text-2xl">
                {shipment.referenceNo}
              </h1>
              <Badge variant="outline" className="text-xs">
                {SHIPMENT_STATUS_LABELS[shipment.status]}
              </Badge>
              {/* Auto-refresh in progress — a hint, never a barrier: the screen stays
                  usable and keeps the data it already has. */}
              {refreshing && (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                  title="Refreshing"
                />
              )}
              {held && (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-300 bg-amber-50 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
                >
                  <Pause className="h-3 w-3" /> On Hold
                </Badge>
              )}
              {cancelled && (
                <Badge
                  variant="outline"
                  className="gap-1 border-red-300 bg-red-50 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                >
                  <Ban className="h-3 w-3" /> Cancelled
                </Badge>
              )}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {shipment.customerCompany} · {shipment.customerRef}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {/* The package (what was sold) leads; the composed services follow. */}
              {(shipment.services ?? []).map((s) => (
                <Badge
                  key={s}
                  variant="secondary"
                  className="text-[11px] font-normal"
                >
                  {labelForService(s)}
                </Badge>
              ))}
            </div>
          </div>

          {/* Progress was invisible before — you had to count ticks down the list. */}
          <div className="w-full shrink-0 rounded-xl border bg-muted/40 p-3 lg:w-64">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Progress
              </span>
              <span className="text-sm font-semibold">
                {doneSteps}
                <span className="text-muted-foreground">/{steps.length}</span>
              </span>
            </div>
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border"
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Steps completed"
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
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
          {/* Import terms — the detention clock and where the empty goes back. Only the
              import package carries them, and both are what the yard asks for. */}
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
            <Fact label="Incoterm" value={shipment.incoterm} icon={FileText} />
          )}
        </dl>
      </section>

      {/* Ops ownership — who runs this job, and why the buttons are missing. */}
      {!locked && unclaimed && (
        <Notice
          tone="warning"
          icon={UserPlus}
          title="Nobody is running this shipment yet"
        >
          Its operations tasks are sitting in the queue. Claim it to take the
          job on — from then on its steps, schedule, documents and costs are
          yours to work.
        </Notice>
      )}
      {!locked && !unclaimed && !opsOwned && (
        <Notice
          tone="neutral"
          icon={UserCheck}
          title={`${shipment.opsOwnerName ?? "Another ops user"} is running this shipment`}
        >
          You can see everything here, but only the owner records progress on
          it. Management can reassign it.
        </Notice>
      )}

      {/* Order lock (RULE-SH-12) — say plainly why nothing can be edited */}
      {locked && (
        <Notice
          tone={lock === "cancelled" ? "danger" : "success"}
          icon={Lock}
          title={
            lock === "cancelled"
              ? "This order was cancelled"
              : "This order is locked"
          }
        >
          {lock === "cancelled"
            ? "It stays on record for reporting, but nothing further can be recorded against it."
            : lock === "closed"
              ? "Every step was confirmed, every invoice paid, and Management has filed it. It is now a read-only record."
              : "Every step is confirmed and every invoice is paid. Steps, documents, schedule, milestones and payments can no longer change — only closing it is left."}
        </Notice>
      )}

      {/* OTD stepper */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <ListChecks className="h-4 w-4 text-primary" /> Order to Delivery
          </h2>
          <span className="text-xs text-muted-foreground">
            {steps.length} steps on this path
          </span>
        </div>
        <ol className="divide-y">
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
            // RULE-SH-13 — a step whose checklist still has required items open cannot
            // complete, and a force override does not bypass it (it is the work itself,
            // not a sequence question).
            const openActions = !done ? (step.actionSummary?.blocking ?? 0) : 0;
            const blocked =
              !ownedByMe ||
              missingDocs ||
              awaitingVerification ||
              openActions > 0;
            const canForce =
              hasPermission("shipment.force_override") && ownedByMe;
            const isOpen = expandedId === step.id;
            return (
              <li
                key={step.id}
                className={`relative transition-colors ${isOpen ? "bg-muted/30" : ""}`}
              >
                {/* Left accent stripe: the step's state readable in peripheral vision,
                      without spending a column on it. */}
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-1 ${done ? "bg-green-500" : isNext ? "bg-primary" : "bg-transparent"}`}
                />

                {/* Stacks on a phone and goes side-by-side from `sm`, so the title and
                      the Complete button stop competing for one cramped row. */}
                <div className="flex flex-col gap-3 p-3 pl-4 sm:flex-row sm:items-start sm:gap-3 sm:p-4 sm:pl-5">
                  {/* The whole title block toggles the panel — a proper button, so it
                        is keyboard-reachable and gives a big touch target, instead of a
                        16px chevron being the only way in. */}
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpandedId(isOpen ? null : step.id)}
                    className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {done ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
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
                          <Badge className="h-5 shrink-0 px-1.5 text-[10px]">
                            Next
                          </Badge>
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
                                  ? "font-medium normal-case text-amber-600 dark:text-amber-400"
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
                              <span
                                key={docType}
                                className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                                  missing
                                    ? "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300"
                                    : "bg-green-50 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-300"
                                }`}
                              >
                                {labelForDocType(docType)}
                              </span>
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
                        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                          Attach:{" "}
                          {docEntry.missing
                            .map((d) => labelForDocType(d))
                            .join(", ")}
                        </p>
                      )}
                      {/* On file but not signed off — names the other half of the gate so
                            nobody hunts for a document that is already attached. */}
                      {!done &&
                        awaitingVerification &&
                        (ownedByMe || isNext) && (
                          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                            Verify:{" "}
                            {docEntry.unverified
                              .map((d) => labelForDocType(d))
                              .join(", ")}
                          </p>
                        )}
                      {!done && openActions > 0 && (ownedByMe || isNext) && (
                        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                          {openActions} checklist item
                          {openActions > 1 ? "s" : ""} still open — open the
                          step to work through {openActions > 1 ? "them" : "it"}
                          .
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
                          className="h-9 flex-1 text-xs sm:h-8 sm:flex-none"
                          disabled={busy || blocked}
                          onClick={() =>
                            act(
                              () => detail.completeStep(step.displayNo),
                              "Step completed",
                            )
                          }
                        >
                          {/* Completing order_lock IS the lock — say so on the button. */}
                          {step.stepCode === "order_lock"
                            ? "Lock order"
                            : "Complete"}
                        </Button>
                      ) : canForce ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 flex-1 gap-1 text-xs sm:h-8 sm:flex-none"
                          disabled={
                            busy ||
                            missingDocs ||
                            awaitingVerification ||
                            openActions > 0
                          }
                          onClick={() =>
                            setDialog({
                              kind: "force",
                              displayNo: step.displayNo,
                              stepCode: step.stepCode,
                            })
                          }
                        >
                          <ShieldAlert className="h-3.5 w-3.5" /> Force complete
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
                          className="h-9 flex-1 gap-1 text-xs sm:h-8 sm:flex-none"
                          disabled={busy}
                          onClick={() =>
                            setDialog({
                              kind: "reopen",
                              displayNo: step.displayNo,
                            })
                          }
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Reopen
                        </Button>
                      )}
                    {/* The chevron stays on mobile, where the row's own tap target is
                          less obvious than on a pointer device. */}
                    <button
                      type="button"
                      aria-label={
                        isOpen ? "Hide step details" : "Show step details"
                      }
                      className="rounded-md p-2 text-muted-foreground hover:bg-muted sm:hidden"
                      onClick={() => setExpandedId(isOpen ? null : step.id)}
                    >
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
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
                    canLinkRegisters={
                      hasPermission("trade.contract.manage") &&
                      mayWrite &&
                      !held
                    }
                    onLinkRegisters={() => setDialog({ kind: "tradeLinks" })}
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
          <p className="border-t bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 sm:px-5">
            Shipment is on hold — OTD writes are blocked until it resumes.
          </p>
        )}
      </section>

      {/* Documents — legal docs gate OTD step completion (RULE-SH-06). This panel and
          the stepper above now read the SAME store, so attaching a required document
          here re-derives the step gating immediately.
          Deliberately no `onChanged`: documentStore publishes the `shipment:{id}` topic,
          which this page already owns — passing one too would refetch twice. */}
      {/* The structured export document pack (roadmap §4). Rendered above the file
          list because the generated packing list and commercial invoice land IN that
          list — the data comes first, the paperwork follows from it. */}
      <TradeDocumentsPanel shipment={shipment} />

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
      {dialog?.kind === "force" && (
        <ForceCompleteDialog
          busy={busy}
          stepLabel={`${dialog.displayNo}. ${prettyStep(dialog.stepCode)}`}
          onClose={() => setDialog(null)}
          onSubmit={(forceReason) =>
            act(
              () => detail.completeStep(dialog.displayNo, { forceReason }),
              "Step completed",
            )
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
                useDocumentStore
                  .getState()
                  .upload({
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
              "Document rejected — the customer has been told",
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
      {dialog?.kind === "tradeLinks" && (
        <TradeLinkDialog
          shipment={shipment}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => act(() => detail.linkTradeRegisters(payload))}
        />
      )}
    </div>
  );
};

const HoldDialog = ({ busy, onClose, onSubmit }) => {
  const [type, setType] = useState("documentation_hold");
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Hold shipment</DialogTitle>
          <DialogDescription>
            Clocks stop and open tasks freeze; documents & chat stay open.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length < 3)
              return toast.error("A reason is required");
            onSubmit({ type, reason: reason.trim() });
          }}
          className="space-y-4 py-2"
        >
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={type}
              onValueChange={setType}
              items={[
                "customs_hold",
                "payment_hold",
                "documentation_hold",
                "weather_hold",
                "customer_request",
                "other",
              ].map((t) => ({ value: t, label: t.replace(/_/g, " ") }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  "customs_hold",
                  "payment_hold",
                  "documentation_hold",
                  "weather_hold",
                  "customer_request",
                  "other",
                ].map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hold-reason">Reason</Label>
            <Input
              id="hold-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Back
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Hold"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const ForceCompleteDialog = ({ busy, stepLabel, onClose, onSubmit }) => {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Force complete step</DialogTitle>
          <DialogDescription>
            {stepLabel} is out of sequence — a justification is recorded in the
            audit trail.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length < 3)
              return toast.error(
                "A justification is required (min 3 characters)",
              );
            onSubmit(reason.trim());
          }}
          className="space-y-4 py-2"
        >
          <div className="space-y-1.5">
            <Label htmlFor="force-reason">Justification</Label>
            <textarea
              id="force-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Back
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Force complete"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const ScheduleDialog = ({ busy, etd, eta, onClose, onSubmit }) => {
  const toInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const [etdVal, setEtdVal] = useState(toInput(etd));
  const [etaVal, setEtaVal] = useState(toInput(eta));
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Set schedule</DialogTitle>
          <DialogDescription>
            Planned departure and arrival dates shown to the customer.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const payload = {};
            if (etdVal) payload.etd = etdVal;
            if (etaVal) payload.eta = etaVal;
            if (!etdVal && !etaVal) return toast.error("Set at least one date");
            if (etdVal && etaVal && etaVal < etdVal)
              return toast.error("ETA cannot be before ETD");
            onSubmit(payload);
          }}
          className="space-y-4 py-2"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sched-etd">ETD</Label>
              <Input
                id="sched-etd"
                type="date"
                value={etdVal}
                onChange={(e) => setEtdVal(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sched-eta">ETA</Label>
              <Input
                id="sched-eta"
                type="date"
                value={etaVal}
                onChange={(e) => setEtaVal(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Back
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length < 3)
              return toast.error("A reason is required");
            onSubmit(reason.trim());
          }}
          className="space-y-4 py-2"
        >
          <div className="space-y-1.5">
            <Label htmlFor="reason-input">{label}</Label>
            <Input
              id="reason-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2">
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
              className={
                destructive
                  ? "bg-destructive text-white hover:bg-destructive/90"
                  : ""
              }
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                confirmText
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/**
 * One block inside the step panel. Every section used to be a bare `<h4>` over a list,
 * which left five headings floating in one undifferentiated column; giving each its own
 * card with a tinted icon chip is what makes the panel scannable.
 *
 * `meta` is the at-a-glance status (a count, a progress figure); `action` is the button
 * that belongs to the section, kept in the header so it never moves as content grows.
 */
const SectionCard = ({ icon: Icon, title, meta, action, children }) => (
  <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
    <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2.5 sm:px-4">
      <h4 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {Icon && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="truncate">{title}</span>
      </h4>
      <div className="flex shrink-0 items-center gap-2">
        {meta}
        {action}
      </div>
    </header>
    <div className="p-3 sm:p-4">{children}</div>
  </section>
);

/* ── The per-step expandable panel: details/form, required docs, proofs, billing. ── */
const StepPanel = ({
  step,
  stepDocs,
  stepInvoices,
  canBill,
  canUpload,
  canTickActions,
  canVerify,
  canLinkRegisters,
  busy,
  onToggleAction,
  onUpload,
  onCreateInvoice,
  onDownload,
  onVerify,
  onLinkRegisters,
}) => {
  const proofs = stepDocs.filter((d) => d.docType === "proof");
  const actions = step.actions ?? [];

  return (
    // Flush to the row's own width — no side margins and no `ml-8` indent — so the
    // panel reads as the step opening downwards rather than as a card floating inside
    // it. The card ground plus the top rule is what separates it from the row above.
    <div className="space-y-3 border-t bg-card p-3 text-sm sm:p-4">
      {/* 2. Sub-action checklist (ADR-048) — the step's actual work, itemised */}
      {actions.length > 0 && (
        <SectionCard
          icon={ListChecks}
          title="Checklist"
          meta={
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                step.actionSummary?.blocking
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                  : "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300"
              }`}
            >
              {step.actionSummary?.done ?? 0} of{" "}
              {step.actionSummary?.total ?? actions.length} done
            </span>
          }
        >
          <ul className="space-y-1">
            {/* Each row wraps instead of overflowing: a document item can carry a status
                chip, a download link, Verify, Reject and Upload all at once, which never
                fit beside the title on a phone. */}
            {actions.map((a) => (
              <li
                key={a.actionCode}
                className="flex flex-col gap-1.5 rounded-md px-1.5 py-1.5 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
              >
                <span
                  className={`flex min-w-0 items-center gap-1.5 ${a.satisfied ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
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
                  {/* A document item is satisfied by the file, never by a tick — so the
                      only action offered is attaching or opening it. */}
                  {a.kind === "document" ? (
                    <>
                      {/* A type that needs a sign-off shows where it stands: a file on
                          its own is not enough to open the gate. */}
                      {a.requiresVerification && a.documentId && (
                        <span
                          className={`text-[10px] rounded px-1.5 py-0.5 border ${
                            a.verificationStatus === "verified"
                              ? "border-green-300 text-green-700 dark:border-green-900 dark:text-green-300"
                              : a.verificationStatus === "rejected"
                                ? "border-red-300 text-red-700 dark:border-red-900 dark:text-red-300"
                                : "border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300"
                          }`}
                        >
                          {a.verificationStatus === "verified"
                            ? "Verified"
                            : a.verificationStatus === "rejected"
                              ? "Rejected"
                              : "Awaiting verification"}
                        </span>
                      )}
                      {a.documentId && (
                        <button
                          type="button"
                          className="text-[11px] text-primary hover:underline flex items-center gap-1"
                          onClick={() =>
                            onDownload({
                              id: a.documentId,
                              fileName: a.documentName,
                            })
                          }
                        >
                          <Download className="w-3 h-3" />{" "}
                          {a.documentName ?? "View"}
                        </button>
                      )}
                      {/* Ops signs off the signed copy — this is what locks the order. */}
                      {canVerify &&
                        a.requiresVerification &&
                        a.documentId &&
                        a.verificationStatus !== "verified" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px]"
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
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] text-destructive"
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
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] gap-1"
                          disabled={busy}
                          onClick={() => onUpload(a.docType)}
                        >
                          <Upload className="w-3 h-3" /> Upload
                        </Button>
                      )}
                    </>
                  ) : canTickActions ? (
                    <Button
                      size="sm"
                      variant={a.satisfied ? "ghost" : "outline"}
                      className="h-6 text-[10px]"
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
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              This step can&apos;t be completed until the{" "}
              {step.actionSummary.blocking} open item
              {step.actionSummary.blocking > 1 ? "s are" : " is"} cleared.
            </p>
          )}
        </SectionCard>
      )}


      {/* 4. Proofs */}
      <SectionCard
        icon={Upload}
        title="Proofs"
        meta={proofs.length > 0 && <span className="text-[11px] text-muted-foreground">{proofs.length}</span>}
        action={
          canUpload && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-[11px]"
              disabled={busy}
              onClick={() => onUpload("proof")}
            >
              <Plus className="h-3 w-3" /> Add
            </Button>
          )
        }
      >
        {proofs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-6 text-center">
            <Upload className="h-5 w-5 text-muted-foreground/50" />
            <p className="mt-1.5 text-xs text-muted-foreground">No proof files attached.</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {proofs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs">{d.fileName}</span>
                </span>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                  onClick={() => onDownload(d)}
                >
                  <Download className="h-3 w-3" /> Download
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 5. Billing — the single money record on a step */}
      <SectionCard
        icon={Receipt}
        title="Invoices"
        meta={stepInvoices.length > 0 && <span className="text-[11px] text-muted-foreground">{stepInvoices.length}</span>}
        action={
          canBill && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-[11px]"
              disabled={busy}
              onClick={onCreateInvoice}
            >
              <Plus className="h-3 w-3" /> New
            </Button>
          )
        }
      >
        {stepInvoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-6 text-center">
            <Receipt className="h-5 w-5 text-muted-foreground/50" />
            <p className="mt-1.5 text-xs text-muted-foreground">No invoices from this step.</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {stepInvoices.map((inv) => {
              const pay = paymentStateOf(inv);
              return (
                <li
                  key={inv.id}
                  className="space-y-1.5 rounded-lg border bg-background px-3 py-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {inv.referenceNo} ·{" "}
                      <span
                        className={
                          inv.kind === "payable"
                            ? "text-orange-600 dark:text-orange-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }
                      >
                        {INVOICE_KIND_LABELS[inv.kind ?? "receivable"]}
                      </span>
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] shrink-0 ${PAYMENT_STATE_CLASS[pay.key] ?? ""}`}
                    >
                      {pay.label}
                    </Badge>
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
                    <ul className="space-y-0.5 pt-0.5 border-t text-[11px] text-muted-foreground">
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
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload to step</DialogTitle>
          <DialogDescription>
            Attach a required document or a proof file to this step.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return toast.error("Choose a file");
            onSubmit({ file, docType });
          }}
          className="space-y-4 py-2"
        >
          <div className="space-y-1.5">
            <Label htmlFor="su-file">File</Label>
            <Input
              id="su-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={docType} onValueChange={setDocType} items={options}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New invoice from step</DialogTitle>
          <DialogDescription>
            Receivable = the customer owes us; Payable = we owe a
            vendor/carrier.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select
                value={kind}
                onValueChange={setKind}
                items={[
                  { value: "receivable", label: "Receivable" },
                  { value: "payable", label: "Payable" },
                ]}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="receivable">
                    Receivable (owed to us)
                  </SelectItem>
                  <SelectItem value="payable">Payable (we owe)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ci-ccy">Currency</Label>
              <Input
                id="ci-ccy"
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          {kind === "payable" && (
            <div className="space-y-1.5">
              <Label>Vendor (who we owe)</Label>
              <Select
                value={vendorId || "none"}
                onValueChange={(v) => setVendorId(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a vendor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— free-text below —</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!vendorId && (
                <Input
                  value={counterparty}
                  onChange={(e) => setCounterparty(e.target.value)}
                  placeholder="e.g. Maersk, ABC Trucking"
                />
              )}
            </div>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Charge lines</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1 h-8"
                onClick={addLine}
              >
                <Plus className="w-3.5 h-3.5" /> Add line
              </Button>
            </div>
            {/* On a phone the description takes its own row and qty/price/delete share
                the next; the 12-column layout only kicks in once there is room for it. */}
            {lines.map((l, i) => (
              <div
                key={i}
                className="grid grid-cols-12 items-center gap-2 rounded-lg border p-2 sm:border-0 sm:p-0"
              >
                <Input
                  className="col-span-12 sm:col-span-6"
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => setLine(i, "description", e.target.value)}
                />
                <Input
                  className="col-span-4 sm:col-span-2"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Qty"
                  value={l.quantity}
                  onChange={(e) => setLine(i, "quantity", e.target.value)}
                />
                <Input
                  className="col-span-6 sm:col-span-3"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Unit price"
                  value={l.unitPrice}
                  onChange={(e) => setLine(i, "unitPrice", e.target.value)}
                />
                <button
                  type="button"
                  className="col-span-2 flex justify-center text-muted-foreground hover:text-destructive disabled:opacity-30 sm:col-span-1"
                  onClick={() => removeLine(i)}
                  disabled={lines.length === 1}
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="text-right text-sm font-semibold">
              Total: {money(total, currency)}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Create draft"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ShipmentDetailPage;
