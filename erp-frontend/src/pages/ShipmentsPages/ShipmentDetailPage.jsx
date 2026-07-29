import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, CheckCircle2, Circle, RotateCcw, Pause, Play, Ban, Lock, Loader2,
  MessageSquare, Receipt, AlertCircle, CalendarClock, ShieldAlert,
  ChevronDown, ChevronUp, Upload, Plus, Banknote, StickyNote, FileText, Download, MapPin, Trash2,
  ListChecks,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import * as shipmentService from "@/services/shipmentService";
import * as otdService from "@/services/otdService";
import * as otcService from "@/services/otcService";
import * as financeService from "@/services/financeService";
import * as documentService from "@/services/documentService";
import * as vendorService from "@/services/vendorService";
import { DOC_TYPE_LABELS, DOC_TYPE_OPTIONS } from "@/services/documentService";
import { INVOICE_KIND_LABELS } from "@/services/financeService";
import {
  SHIPMENT_STATUS_LABELS, OTC_MILESTONE_LABELS, INVOICE_STATUS_LABELS, labelForService,
  CRO_HANDLING_SHORT, labelForPackage, paymentStateOf, PAYMENT_STATE_CLASS, DEFAULT_CURRENCY,
  routeOf,
} from "@/lib/catalog";
import { onSocket, joinRoom } from "@/lib/socket";
import DocumentsPanel from "@/components/DocumentsPanel";

const prettyStep = (code) => code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const money = (n, ccy) => `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

// Role → department (RULE-SH-04 ownership). Management roles deliberately map to
// null — they oversee but cannot complete steps themselves.
const DEPT_BY_ROLE = {
  ops_manager: "operations", ops_exec: "operations",
  compliance_manager: "compliance", compliance_exec: "compliance",
  transport_manager: "transport", transport_exec: "transport",
  accounts: "finance", hr: "hr",
  asm: "sales", bdo: "sales",
};
// A multi-role employee owns steps for every department their roles map to.
const departmentsForUser = (user) => {
  const roles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  return [...new Set(roles.map((r) => DEPT_BY_ROLE[r]).filter(Boolean))];
};
const DEPT_LABELS = { operations: "Operations", compliance: "Compliance", transport: "Transport", finance: "Finance", hr: "HR", sales: "Sales", management: "Management" };

// One-line plain-language meaning per step, so whoever owns it knows the job.
const STEP_HINTS = {
  order_lock: "Attach the signed Rate Confirmation (RC) — the order locks against it and nothing downstream moves until it is on file.",
  order_confirmed: "Collect the customer's document pack and confirm the order — work the checklist below.",
  lc_generated: "Letter of Credit raised/received for this trade.",
  container_allocated: "Book and allocate the container(s).",
  vessel_booked: "Apply to the shipping line for a vessel slot.",
  cro_released: "Apply to the shipping line and obtain the Container Release Order.",
  cro_received_from_customer: "The customer is supplying the CRO — chase them for the copy and attach it.",
  // Package: Local Transport — inland trucking, no container and no port.
  transporter_assigned: "Book a transporter for the run and agree the rate.",
  vehicle_dispatched: "Send the vehicle to the customer's pickup point.",
  goods_loaded: "Goods loaded at the pickup point; capture proof of loading.",
  in_transit: "Vehicle is on the road to the delivery point.",
  local_delivered: "Goods delivered to the delivery address; collect the POD.",
  // Package: Loading Point → Port — the job ends at the terminal gate.
  port_job_completed: "Cargo handed over at the port — the job is complete.",
  empty_container_pickup: "Pick up the empty container from the yard (pay LOLO); capture the pickup EIR.",
  cargo_pickup: "Stuff the container at the customer premises and apply the shipper's seal.",
  inland_transit: "Move the container from origin to the port.",
  customs_clearance: "File the GD, pay duty, get the cargo examined and sealed — work the checklist below.",
  customs_entry: "File the customs entry / GD declaration.",
  inspected_sealed: "Cargo inspected and the customs seal applied.",
  port_handover: "Gate the container in at the terminal; capture the gate-in EIR.",
  bol_issued: "Bill of Lading issued by the shipping line.",
  bol_submitted: "BOL submitted to the bank / counterparty.",
  telex_released: "Telex release / BL surrender confirmed.",
  destination_inspection: "Inspection at the destination port.",
  destination_do: "Destination agent obtains the Delivery Order & gate pass.",
  destination_pickup: "Destination agent picks up the container; capture the pickup EIR.",
  delivered: "Cargo delivered to the consignee (POD).",
  empty_return: "Return the empty container to the yard; capture the empty-return EIR.",
  // Package: Port → Consignee — the import delivery leg, run on our own vehicles.
  import_container_pickup: "Take the delivery order and gate pass to the terminal, collect the container and capture the pickup EIR.",
  import_empty_return: "Return the empty container to the yard or dry port; capture the empty-return EIR. This is the last step of the job.",
};

const ShipmentDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);

  const [shipment, setShipment] = useState(null);
  const [checklist, setChecklist] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [pnl, setPnl] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [expandedId, setExpandedId] = useState(null); // which step's panel is open
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // { kind, payload }

  // Job P&L is management/finance reporting, not day-to-day step work.
  const canViewPnl = hasPermission("report.read");

  const load = useCallback(async () => {
    try {
      const [res, docsRes, docListRes, pnlRes] = await Promise.all([
        shipmentService.getShipment(id),
        // Checklist + document list are advisory UX — a failure must not sink the page.
        documentService.requiredDocs(id).catch(() => null),
        documentService.listDocuments("shipment", id).catch(() => null),
        canViewPnl ? shipmentService.getShipmentPnl(id).catch(() => null) : Promise.resolve(null),
      ]);
      setShipment(res.data);
      // The endpoint answers { shipmentId, checklist } — take the array, or the
      // stepper blows up trying to map an object.
      setChecklist(docsRes?.data?.checklist ?? []);
      setDocuments(docListRes?.data ?? []);
      setPnl(pnlRes?.data ?? null);
      setError(null);
    } catch (err) {
      setError(err?.message || "Failed to load shipment");
    } finally {
      setLoading(false);
    }
  }, [id, canViewPnl]);

  // Vendors for the payable-invoice dialog. Loaded once, best-effort.
  useEffect(() => {
    if (!hasPermission("invoice.create")) return;
    vendorService.listVendors({ isActive: true }).then((r) => setVendors(r.data || [])).catch(() => {});
  }, [hasPermission]);

  useEffect(() => { load(); }, [load]);

  // Live: join the shipment room, refetch on any updated/stepCompleted hint (EDGE-T-05).
  useEffect(() => {
    const leave = joinRoom("shipment", id);
    const offs = [
      onSocket("shipment:updated", (p) => { if (p?.shipmentId === id) load(); }),
      onSocket("shipment:stepCompleted", (p) => { if (p?.shipmentId === id) load(); }),
    ];
    return () => { offs.forEach((off) => off()); leave(); };
  }, [id, load]);

  const act = async (fn, msg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      setDialog(null);
      await load();
    } catch (err) {
      toast.error(err?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (error) return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate("/admin/shipments")}><ArrowLeft className="w-4 h-4" /> Back</Button>
      <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive"><AlertCircle className="w-5 h-5" /><p className="text-sm font-medium">{error}</p></div>
    </div>
  );
  if (!shipment) return null;

  const held = shipment.exceptionState === "on_hold";
  const cancelled = shipment.exceptionState === "cancelled";
  // The order lock (RULE-SH-12) — mirrors lockStateOf() on the server. Settled
  // means every step is confirmed AND every invoice paid; from here the record
  // is history, so the UI stops offering edits instead of letting the API 409.
  const lock = cancelled ? "cancelled" : ["settled", "closed"].includes(shipment.status) ? shipment.status : null;
  const locked = !!lock;
  const steps = shipment.otdSteps ?? [];
  const firstPendingDisplayNo = steps.find((s) => s.status === "pending")?.displayNo;
  const myDepartments = departmentsForUser(user);
  const checklistByStep = Object.fromEntries((checklist ?? []).map((c) => [c.stepCode, c]));
  // Group documents + invoices under the step they belong to (Phase-2 per-step UI).
  const docsByStep = (documents ?? []).reduce((m, d) => {
    if (d.otdStepId) (m[d.otdStepId] ??= []).push(d);
    return m;
  }, {});
  const invoicesByStep = (shipment.invoices ?? []).reduce((m, inv) => {
    if (inv.otdStepId) (m[inv.otdStepId] ??= []).push(inv);
    return m;
  }, {});
  const canBill = hasPermission("invoice.create");

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate("/admin/shipments")}><ArrowLeft className="w-4 h-4" /> Shipments</Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-primary">{shipment.referenceNo}</h1>
            <Badge variant="outline" className="text-xs">{SHIPMENT_STATUS_LABELS[shipment.status]}</Badge>
            {held && <Badge variant="outline" className="text-xs gap-1 bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300"><Pause className="w-3 h-3" /> On Hold</Badge>}
            {cancelled && <Badge variant="outline" className="text-xs gap-1 bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300"><Ban className="w-3 h-3" /> Cancelled</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{shipment.customerCompany} · {shipment.customerRef}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {/* The package (what was sold) leads; the composed services follow. */}
            {shipment.servicePackage && (
              <Badge className="text-[10px]">{labelForPackage(shipment.servicePackage)}</Badge>
            )}
            {shipment.croHandledBy && shipment.croHandledBy !== "not_applicable" && (
              <Badge variant="outline" className="text-[10px]">{CRO_HANDLING_SHORT[shipment.croHandledBy]}</Badge>
            )}
            {(shipment.services ?? []).map((s) => <Badge key={s} variant="secondary" className="text-[10px]">{labelForService(s)}</Badge>)}
          </div>
          {routeOf(shipment) && (
            <p className="text-xs text-muted-foreground mt-2">{routeOf(shipment)}</p>
          )}
          {/* Import terms — the detention clock and where the empty goes back. Only the
              import package carries them, and both are what the yard asks for. */}
          {(shipment.freeDays != null || shipment.emptyReturnLocation) && (
            <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2">
              {shipment.freeDays != null && (
                <span>Free days <span className="font-medium text-foreground">{shipment.freeDays}</span></span>
              )}
              {shipment.freeDays != null && shipment.emptyReturnLocation && <span>·</span>}
              {shipment.emptyReturnLocation && (
                <span>Empty return <span className="font-medium text-foreground">{shipment.emptyReturnLocation}</span></span>
              )}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <CalendarClock className="w-3.5 h-3.5" />
            <span>ETD <span className="font-medium text-foreground">{fmtDate(shipment.etd)}</span></span>
            <span className="mx-1">·</span>
            <span>ETA <span className="font-medium text-foreground">{fmtDate(shipment.eta)}</span></span>
          </p>
        </div>

        {/* Exception + close actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {hasPermission("shipment.schedule") && !locked && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setDialog({ kind: "schedule" })}>
              <CalendarClock className="w-4 h-4" /> Set schedule
            </Button>
          )}
          {shipment.chatChannelId && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/admin/chat", { state: { channelId: shipment.chatChannelId } })}>
              <MessageSquare className="w-4 h-4" /> Chat
            </Button>
          )}
          {!held && !locked && hasPermission("shipment.hold") && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setDialog({ kind: "hold" })}><Pause className="w-4 h-4" /> Hold</Button>
          )}
          {held && hasPermission("shipment.resume") && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setDialog({ kind: "resume" })}><Play className="w-4 h-4" /> Resume</Button>
          )}
          {!locked && hasPermission("shipment.cancel") && (
            <Button variant="outline" size="sm" className="gap-2 text-destructive" onClick={() => setDialog({ kind: "cancel" })}><Ban className="w-4 h-4" /> Cancel</Button>
          )}
          {shipment.status === "settled" && hasPermission("shipment.close") && (
            <Button size="sm" className="gap-2" onClick={() => act(() => shipmentService.closeShipment(id), "Shipment closed")} disabled={busy}><Lock className="w-4 h-4" /> Close</Button>
          )}
        </div>
      </div>

      {/* Order lock (RULE-SH-12) — say plainly why nothing can be edited */}
      {locked && (
        <div className={`flex items-start gap-3 p-4 rounded-xl border ${lock === "cancelled"
          ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          : "border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200"}`}>
          <Lock className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">
              {lock === "cancelled" ? "This order was cancelled" : "This order is locked"}
            </p>
            <p className="mt-0.5 opacity-90">
              {lock === "cancelled"
                ? "It stays on record for reporting, but nothing further can be recorded against it."
                : lock === "closed"
                  ? "Every step was confirmed, every invoice paid, and Management has filed it. It is now a read-only record."
                  : "Every step is confirmed and every invoice is paid. Steps, documents, schedule, milestones and payments can no longer change — only closing it is left."}
            </p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* OTD stepper */}
        <div className="lg:col-span-2 border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5">
          <h2 className="font-semibold mb-4 flex items-center gap-2">Order to Delivery <span className="text-xs text-muted-foreground font-normal">({steps.length} steps on this path)</span></h2>
          <ol className="space-y-1">
            {steps.map((step) => {
              const done = step.status === "done";
              const isNext = step.displayNo === firstPendingDisplayNo;
              const ownedByMe = myDepartments.includes(step.ownerDepartment);
              const docEntry = checklistByStep[step.stepCode];
              const missingDocs = !done && (docEntry?.missing?.length ?? 0) > 0;
              // RULE-SH-13 — a step whose checklist still has required items open cannot
              // complete, and a force override does not bypass it (it is the work itself,
              // not a sequence question).
              const openActions = !done ? step.actionSummary?.blocking ?? 0 : 0;
              const blocked = !ownedByMe || missingDocs || openActions > 0;
              const canForce = hasPermission("shipment.force_override") && ownedByMe;
              return (
                <li key={step.id} className="py-2 border-b last:border-0">
                 <div className="flex items-start gap-3">
                  {done ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" /> : <Circle className={`w-5 h-5 shrink-0 mt-0.5 ${isNext ? "text-primary" : "text-muted-foreground/40"}`} />}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}>
                      {step.displayNo}. {prettyStep(step.stepCode)}
                    </p>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
                      {step.ownerDepartment}{step.forced ? " · forced" : ""}
                      {step.actionSummary && (
                        <>
                          {" · "}
                          <span className={openActions > 0 ? "text-amber-600 dark:text-amber-400 normal-case font-medium" : "normal-case"}>
                            checklist {step.actionSummary.done}/{step.actionSummary.total}
                          </span>
                        </>
                      )}
                    </p>
                    {(docEntry?.required?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {docEntry.required.map((docType) => {
                          const missing = (docEntry.missing ?? []).includes(docType);
                          return (
                            <span key={docType} className={`text-[10px] px-1.5 py-0.5 rounded-full border ${missing
                              ? "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300"
                              : "bg-green-50 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-300"}`}>
                              {DOC_TYPE_LABELS[docType] ?? docType}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {!done && isNext && !ownedByMe && (
                      <p className="text-[11px] text-muted-foreground mt-1">Owned by {DEPT_LABELS[step.ownerDepartment] ?? step.ownerDepartment}</p>
                    )}
                    {!done && missingDocs && (ownedByMe || isNext) && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        Attach: {docEntry.missing.map((d) => DOC_TYPE_LABELS[d] ?? d).join(", ")}
                      </p>
                    )}
                    {!done && openActions > 0 && (ownedByMe || isNext) && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        {openActions} checklist item{openActions > 1 ? "s" : ""} still open — expand the step to work through {openActions > 1 ? "them" : "it"}.
                      </p>
                    )}
                  </div>
                  {!done && !held && !locked && hasPermission("shipment.step.complete") && (
                    isNext ? (
                      <Button size="sm" className="h-8 text-xs shrink-0" disabled={busy || blocked}
                        onClick={() => act(() => otdService.completeStep(id, step.displayNo, { rowVersion: shipment.rowVersion }), "Step completed")}>
                        Complete
                      </Button>
                    ) : canForce ? (
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1 shrink-0" disabled={busy || missingDocs || openActions > 0}
                        onClick={() => setDialog({ kind: "force", displayNo: step.displayNo, stepCode: step.stepCode })}>
                        <ShieldAlert className="w-3.5 h-3.5" /> Force complete
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground shrink-0 self-center">Waiting for earlier steps</span>
                    )
                  )}
                  {done && !locked && hasPermission("shipment.step.reopen") && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 shrink-0" disabled={busy}
                      onClick={() => setDialog({ kind: "reopen", displayNo: step.displayNo })}>
                      <RotateCcw className="w-3.5 h-3.5" /> Reopen
                    </Button>
                  )}
                  <button type="button" aria-label="Toggle step details"
                    className="shrink-0 mt-0.5 p-1 rounded hover:bg-muted text-muted-foreground"
                    onClick={() => setExpandedId(expandedId === step.id ? null : step.id)}>
                    {expandedId === step.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                 </div>

                 {expandedId === step.id && (
                    <StepPanel
                      step={step}
                      shipment={shipment}
                      docEntry={docEntry}
                      stepDocs={docsByStep[step.id] ?? []}
                      stepInvoices={invoicesByStep[step.id] ?? []}
                      canBill={canBill}
                      canEditNotes={hasPermission("shipment.step.complete") && !locked && !held}
                      canUpload={hasPermission("document.upload") && !locked}
                      canTickActions={hasPermission("shipment.step.complete") && ownedByMe && !locked && !held && !done}
                      busy={busy}
                      onToggleAction={(a, next) => act(
                        () => otdService.setStepAction(id, step.displayNo, a.actionCode, next),
                        next ? `"${a.title}" marked done` : `"${a.title}" reopened`,
                      )}
                      onSaveNotes={(notes) => act(() => otdService.updateStepDetails(id, step.displayNo, { notes }), "Step details saved")}
                      onUpload={(docType) => setDialog({ kind: "stepUpload", stepId: step.id, docType })}
                      onCreateInvoice={() => setDialog({ kind: "createInvoice", stepId: step.id, stepCode: step.stepCode })}
                      onDownload={(d) => documentService.downloadDocument(d.id, d.fileName)}
                    />
                 )}
                </li>
              );
            })}
          </ol>
          {held && <p className="text-xs text-amber-600 mt-3">Shipment is on hold — OTD writes are blocked until it resumes.</p>}
        </div>

        {/* OTC + invoices */}
        <div className="space-y-6">
          {/* Job P&L (freight-forwarding OTC upgrade) */}
          {pnl && <PnlCard pnl={pnl} />}

               {/* OTC — invoice & payment tracking (receivables vs payables) */}
          <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Receipt className="w-4 h-4" /> Invoice &amp; Payment Tracking</h2>
            {(shipment.invoices ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <div className="space-y-4">
                {["receivable", "payable"].map((kind) => {
                  const list = (shipment.invoices ?? []).filter((i) => (i.kind ?? "receivable") === kind);
                  if (!list.length) return null;
                  const outstanding = list
                    .filter((i) => i.status !== "void")
                    .reduce((s, i) => s + Number(i.totalAmount) - (i.payments ?? []).reduce((a, p) => a + Number(p.amount), 0), 0);
                  return (
                    <div key={kind}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-semibold ${kind === "payable" ? "text-orange-600 dark:text-orange-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {INVOICE_KIND_LABELS[kind]}{kind === "receivable" ? " (owed to us)" : " (we owe)"}
                        </span>
                        <span className="text-xs text-muted-foreground">Outstanding {money(outstanding, list[0]?.currency)}</span>
                      </div>
                      <div className="space-y-2">
                        {list.map((inv) => (
                          <InvoiceRow key={inv.id} inv={inv} locked={locked} busy={busy} hasPermission={hasPermission}
                            onIssue={() => act(() => financeService.issueInvoice(inv.id), "Invoice issued")}
                            onPay={() => setDialog({ kind: "payment", invoiceId: inv.id })}
                            onVoid={() => setDialog({ kind: "void", invoiceId: inv.id })} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-3">Receivables drive OTC milestones 1–2 &amp; settlement; payables are tracked separately.</p>
          </div>

          <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5">
            <h2 className="font-semibold mb-3">Order to Cash</h2>
            <ol className="space-y-2">
              {(shipment.otcMilestones ?? []).map((m) => {
                const done = m.status === "done";
                const canComplete = [3, 4, 5].includes(m.milestoneNo) && !done && !locked && !held && hasPermission("otc.update");
                return (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    {done ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" /> : <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                    <span className={`flex-1 ${done ? "text-muted-foreground" : ""}`}>{m.milestoneNo}. {OTC_MILESTONE_LABELS[m.type]}</span>
                    {canComplete && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy}
                        onClick={() => act(() => otcService.completeMilestone(id, m.milestoneNo), "Milestone completed")}>Mark done</Button>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className="text-[11px] text-muted-foreground mt-2">Milestones 1–2 complete automatically on invoice issue & payment.</p>
          </div>

     

          {/* Exceptions */}
          {(shipment.exceptions ?? []).length > 0 && (
            <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5">
              <h2 className="font-semibold mb-3">Exception history</h2>
              <ul className="space-y-2 text-sm">
                {shipment.exceptions.map((ex) => (
                  <li key={ex.id} className="border-l-2 border-amber-400 pl-3">
                    <p className="font-medium">{ex.type.replace(/_/g, " ")}</p>
                    <p className="text-muted-foreground text-xs">{ex.reason}{ex.resolvedAt ? ` · resolved (${ex.holdMinutes} min)` : " · open"}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Documents — legal docs gate OTD step completion (RULE-SH-06) */}
      <DocumentsPanel ownerType="shipment" ownerId={id} showRequired locked={locked} />

      {/* Dialogs */}
      {dialog?.kind === "hold" && (
        <HoldDialog busy={busy} onClose={() => setDialog(null)}
          onSubmit={(payload) => act(() => shipmentService.holdShipment(id, payload), "Shipment held")} />
      )}
      {dialog?.kind === "resume" && (
        <ReasonDialog busy={busy} title="Resume shipment" label="Resolution notes" confirmText="Resume" onClose={() => setDialog(null)}
          onSubmit={(notes) => act(() => shipmentService.resumeShipment(id, notes), "Shipment resumed")} />
      )}
      {dialog?.kind === "cancel" && (
        <ReasonDialog busy={busy} title="Cancel shipment" label="Cancellation reason" confirmText="Cancel Shipment" destructive onClose={() => setDialog(null)}
          onSubmit={(reason) => act(() => shipmentService.cancelShipment(id, reason), "Shipment cancelled")} />
      )}
      {dialog?.kind === "force" && (
        <ForceCompleteDialog busy={busy} stepLabel={`${dialog.displayNo}. ${prettyStep(dialog.stepCode)}`} onClose={() => setDialog(null)}
          onSubmit={(forceReason) => act(() => otdService.completeStep(id, dialog.displayNo, { rowVersion: shipment.rowVersion, forceReason }), "Step completed")} />
      )}
      {dialog?.kind === "schedule" && (
        <ScheduleDialog busy={busy} etd={shipment.etd} eta={shipment.eta} onClose={() => setDialog(null)}
          onSubmit={(payload) => act(() => shipmentService.setSchedule(id, payload), "Schedule updated")} />
      )}
      {dialog?.kind === "reopen" && (
        <ReasonDialog busy={busy} title={`Reopen step ${dialog.displayNo}`} label="Reopen reason" confirmText="Reopen" onClose={() => setDialog(null)}
          onSubmit={(reason) => act(() => otdService.reopenStep(id, dialog.displayNo, reason), "Step reopened")} />
      )}
      {dialog?.kind === "void" && (
        <ReasonDialog busy={busy} title="Void invoice" label="Void reason" confirmText="Void" destructive onClose={() => setDialog(null)}
          onSubmit={(reason) => act(() => financeService.voidInvoice(dialog.invoiceId, reason), "Invoice voided")} />
      )}
      {dialog?.kind === "payment" && (
        <PaymentDialog busy={busy} onClose={() => setDialog(null)}
          onSubmit={(payload) => act(() => financeService.recordPayment(dialog.invoiceId, payload), "Payment recorded")} />
      )}
      {dialog?.kind === "stepUpload" && (
        <StepUploadDialog busy={busy} presetDocType={dialog.docType} onClose={() => setDialog(null)}
          onSubmit={({ file, docType }) => act(
            () => documentService.uploadDocument({ file, ownerType: "shipment", ownerId: id, docType, otdStepId: dialog.stepId }),
            "File uploaded",
          )} />
      )}
      {dialog?.kind === "createInvoice" && (
        <CreateInvoiceDialog busy={busy} defaultCurrency={(shipment.invoices?.[0]?.currency) || DEFAULT_CURRENCY} vendors={vendors} onClose={() => setDialog(null)}
          onSubmit={(payload) => act(
            () => financeService.createInvoice({ ...payload, shipmentId: id, otdStepId: dialog.stepId }),
            "Invoice drafted",
          )} />
      )}
    </div>
  );
};

/* ── Job P&L card — invoiced money vs what the approved quote promised. ── */
const PnlCard = ({ pnl }) => {
  const m = (n) => `${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const marginPct = pnl.revenue.actual > 0 ? Math.round((pnl.margin.actual / pnl.revenue.actual) * 100) : null;
  return (
    <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5">
      <h2 className="font-semibold mb-3 flex items-center gap-2"><Banknote className="w-4 h-4" /> Job Profitability</h2>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Revenue</p>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{m(pnl.revenue.actual)}</p>
          <p className="text-[10px] text-muted-foreground">quoted {m(pnl.revenue.estimated)}</p>
        </div>
        <div className="rounded-lg border p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost</p>
          <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">{m(pnl.cost.actual)}</p>
          <p className="text-[10px] text-muted-foreground">quoted {m(pnl.cost.estimated)}</p>
        </div>
        <div className="rounded-lg border p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Margin</p>
          <p className={`text-sm font-semibold ${pnl.margin.actual >= 0 ? "text-primary" : "text-destructive"}`}>{m(pnl.margin.actual)}</p>
          <p className="text-[10px] text-muted-foreground">{marginPct != null ? `${marginPct}%` : `quoted ${m(pnl.margin.estimated)}`}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3 text-[11px] text-muted-foreground">
        <span>Invoiced · collected {m(pnl.revenue.collected)} · paid {m(pnl.cost.paid)}</span>
        {pnl.openPayables?.count > 0 && (
          <Badge variant="outline" className="text-[10px] bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-300">
            {pnl.openPayables.count} open payable{pnl.openPayables.count > 1 ? "s" : ""} · {m(pnl.openPayables.amount)}
          </Badge>
        )}
      </div>
      {pnl.mixedCurrency && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2">Mixed currencies converted at stored FX — figures approximate.</p>}
    </div>
  );
};

const HoldDialog = ({ busy, onClose, onSubmit }) => {
  const [type, setType] = useState("documentation_hold");
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Hold shipment</DialogTitle>
          <DialogDescription>Clocks stop and open tasks freeze; documents & chat stay open.</DialogDescription></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 3) return toast.error("A reason is required"); onSubmit({ type, reason: reason.trim() }); }} className="space-y-4 py-2">
          <div className="space-y-1.5"><Label>Type</Label>
            <Select value={type} onValueChange={setType} items={["customs_hold", "payment_hold", "documentation_hold", "weather_hold", "customer_request", "other"].map((t) => ({ value: t, label: t.replace(/_/g, " ") }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["customs_hold", "payment_hold", "documentation_hold", "weather_hold", "customer_request", "other"].map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="hold-reason">Reason</Label>
            <Input id="hold-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Hold"}</Button>
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
          <DialogDescription>{stepLabel} is out of sequence — a justification is recorded in the audit trail.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 3) return toast.error("A justification is required (min 3 characters)"); onSubmit(reason.trim()); }} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="force-reason">Justification</Label>
            <textarea id="force-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none" />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Force complete"}</Button>
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
          <DialogDescription>Planned departure and arrival dates shown to the customer.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => {
          e.preventDefault();
          const payload = {};
          if (etdVal) payload.etd = etdVal;
          if (etaVal) payload.eta = etaVal;
          if (!etdVal && !etaVal) return toast.error("Set at least one date");
          if (etdVal && etaVal && etaVal < etdVal) return toast.error("ETA cannot be before ETD");
          onSubmit(payload);
        }} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="sched-etd">ETD</Label>
              <Input id="sched-etd" type="date" value={etdVal} onChange={(e) => setEtdVal(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="sched-eta">ETA</Label>
              <Input id="sched-eta" type="date" value={etaVal} onChange={(e) => setEtaVal(e.target.value)} /></div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const ReasonDialog = ({ busy, title, label, confirmText, destructive, onClose, onSubmit }) => {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 3) return toast.error("A reason is required"); onSubmit(reason.trim()); }} className="space-y-4 py-2">
          <div className="space-y-1.5"><Label htmlFor="reason-input">{label}</Label>
            <Input id="reason-input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy} className={destructive ? "bg-destructive text-white hover:bg-destructive/90" : ""}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const PaymentDialog = ({ busy, onClose, onSubmit }) => {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [ref, setRef] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Full settlement auto-completes OTC milestone 2.</DialogDescription></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (!(Number(amount) > 0)) return toast.error("Enter an amount"); onSubmit({ amount: Number(amount), method, referenceNumber: ref || undefined }); }} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="pay-amt">Amount</Label>
              <Input id="pay-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
            <div className="space-y-1.5"><Label>Method</Label>
              <Select value={method} onValueChange={setMethod} items={["bank_transfer", "cheque", "cash", "lc_settlement", "other"].map((m) => ({ value: m, label: m.replace(/_/g, " ") }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["bank_transfer", "cheque", "cash", "lc_settlement", "other"].map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="pay-ref">Reference (optional)</Label>
            <Input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Record"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ── An invoice row: paid/unpaid at a glance, full detail on expand. ── */
const InvoiceRow = ({ inv, locked, busy, hasPermission, onIssue, onPay, onVoid }) => {
  const [open, setOpen] = useState(false);
  const pay = paymentStateOf(inv);
  const lines = inv.lines ?? [];
  const party = inv.vendor?.name ?? inv.counterparty;

  return (
    <div className="border rounded-lg text-sm">
      {/* Summary — reference, what's owed, and whether it's been paid */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="flex items-center gap-1.5 min-w-0 text-left" onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronUp className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
            <span className="font-medium truncate">{inv.referenceNo}</span>
          </button>
          <Badge variant="outline" className={`text-[10px] shrink-0 ${PAYMENT_STATE_CLASS[pay.key] ?? ""}`}>{pay.label}</Badge>
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{money(inv.totalAmount, inv.currency)}</span>
          {pay.key !== "void" && (
            <span className="text-xs text-muted-foreground">
              {pay.key === "paid"
                ? `paid in full${inv.payments?.length ? ` · ${inv.payments.length} payment${inv.payments.length > 1 ? "s" : ""}` : ""}`
                : `${money(pay.outstanding, inv.currency)} outstanding`}
            </span>
          )}
        </div>

        {/* An unpaid invoice nobody has issued yet can't be collected — say so, since
            "Unpaid" alone doesn't explain why Record payment is unavailable. */}
        {pay.notYetIssued && pay.key !== "void" && (
          <p className="text-[11px] text-muted-foreground">
            Not yet {inv.kind === "payable" ? "approved for payment" : "issued to the customer"}.
          </p>
        )}
        {inv.status === "void" && inv.voidReason && (
          <p className="text-[11px] text-muted-foreground">Voided — {inv.voidReason}</p>
        )}
        {party && <p className="text-xs text-muted-foreground truncate">Party: {party}</p>}
      </div>

      {/* Detail — what is being billed, the dates, and every payment against it */}
      {open && (
        <div className="border-t bg-muted/20 px-3 py-2.5 space-y-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <span className="text-muted-foreground">Type <b className="text-foreground font-medium">{INVOICE_KIND_LABELS[inv.kind ?? "receivable"]}</b></span>
            <span className="text-muted-foreground">Stage <b className="text-foreground font-medium">{INVOICE_STATUS_LABELS[inv.status]}</b></span>
            <span className="text-muted-foreground">Issued <b className="text-foreground font-medium">{fmtDate(inv.issuedAt)}</b></span>
            <span className="text-muted-foreground">Due <b className="text-foreground font-medium">{fmtDate(inv.dueDate)}</b></span>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Charge lines</p>
            {lines.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No line breakdown recorded.</p>
            ) : (
              <ul className="space-y-1">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-2 text-[11px]">
                    <span className="min-w-0">
                      <span className="block truncate">{l.description}</span>
                      <span className="text-muted-foreground">
                        {Number(l.quantity)} × {money(l.unitPrice, inv.currency)}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium">{money(l.amount, inv.currency)}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t font-semibold">
                  <span>Total</span><span>{money(inv.totalAmount, inv.currency)}</span>
                </li>
              </ul>
            )}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Payments</p>
            {(inv.payments ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Nothing received yet.</p>
            ) : (
              <ul className="space-y-0.5 text-[11px]">
                {inv.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground truncate">
                      {fmtDate(p.receivedAt)} · {(p.method || "").replace(/_/g, " ")}
                      {p.referenceNumber ? ` · ${p.referenceNumber}` : ""}
                    </span>
                    <span className="shrink-0 font-medium text-emerald-600 dark:text-emerald-400">{money(p.amount, inv.currency)}</span>
                  </li>
                ))}
                {pay.outstanding > 0 && (
                  <li className="flex items-center justify-between gap-2 pt-1 border-t font-semibold">
                    <span>Outstanding</span><span>{money(pay.outstanding, inv.currency)}</span>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}

      {!locked && (inv.status === "draft" || ["issued", "part_paid"].includes(inv.status)) && (
        <div className="flex flex-wrap gap-1 px-3 pb-3">
          {inv.status === "draft" && hasPermission("invoice.issue") && (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={onIssue}>{inv.kind === "payable" ? "Approve" : "Issue"}</Button>
          )}
          {["issued", "part_paid"].includes(inv.status) && hasPermission("payment.record") && (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={onPay}>Record payment</Button>
          )}
          {["draft", "issued"].includes(inv.status) && hasPermission("invoice.void") && (
            <Button size="sm" variant="ghost" className="h-7 text-[11px] text-destructive" disabled={busy} onClick={onVoid}>Void</Button>
          )}
        </div>
      )}
    </div>
  );
};

/* ── The per-step expandable panel: details/form, required docs, proofs, billing. ── */
const StepPanel = ({ step, shipment, docEntry, stepDocs, stepInvoices, canBill, canEditNotes, canUpload, canTickActions, busy, onSaveNotes, onToggleAction, onUpload, onCreateInvoice, onDownload }) => {
  const [notes, setNotes] = useState(step.notes ?? "");
  const route = routeOf(shipment);
  const proofs = stepDocs.filter((d) => d.docType === "proof");
  const actions = step.actions ?? [];
  // Doc types the checklist already covers — listing them twice would read as two
  // separate requirements when they are one (the gate unions both sources server-side).
  const coveredByActions = new Set(actions.filter((a) => a.docType).map((a) => a.docType));
  const required = (docEntry?.required ?? []).filter((dt) => !coveredByActions.has(dt));
  const missing = new Set(docEntry?.missing ?? []);

  return (
    <div className="ml-8 mt-2 mb-1 rounded-lg border bg-muted/20 p-3 space-y-4 text-sm">
      {/* 1. Form / details */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Details</h4>
        <p className="text-muted-foreground">{STEP_HINTS[step.stepCode] ?? prettyStep(step.stepCode)}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {route && <span>Route: <b className="text-foreground">{route}</b></span>}
          {shipment.incoterm && <span>Incoterm: <b className="text-foreground">{shipment.incoterm}</b></span>}
          <span>Owner: <b className="text-foreground">{DEPT_LABELS[step.ownerDepartment] ?? step.ownerDepartment}</b></span>
          <span>ETD: <b className="text-foreground">{fmtDate(shipment.etd)}</b> · ETA: <b className="text-foreground">{fmtDate(shipment.eta)}</b></span>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1"><StickyNote className="w-3.5 h-3.5" /> Notes</Label>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEditNotes}
            placeholder={canEditNotes ? "Handover notes for this step…" : "No notes"}
            className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none disabled:opacity-70" />
          {canEditNotes && (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy || notes === (step.notes ?? "")} onClick={() => onSaveNotes(notes)}>Save notes</Button>
          )}
        </div>
      </section>

      {/* 2. Sub-action checklist (ADR-048) — the step's actual work, itemised */}
      {actions.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <ListChecks className="w-3.5 h-3.5" /> Checklist
            </h4>
            <span className={`text-[11px] ${step.actionSummary?.blocking ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
              {step.actionSummary?.done ?? 0} of {step.actionSummary?.total ?? actions.length} done
            </span>
          </div>
          <ul className="space-y-1">
            {actions.map((a) => (
              <li key={a.actionCode} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50">
                <span className={`flex items-center gap-1.5 min-w-0 ${a.satisfied ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                  {a.satisfied ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <Circle className="w-3.5 h-3.5 shrink-0" />}
                  <span className="truncate">{a.title}</span>
                  {!a.required && <span className="text-[10px] text-muted-foreground shrink-0">(optional)</span>}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {/* A document item is satisfied by the file, never by a tick — so the
                      only action offered is attaching or opening it. */}
                  {a.kind === "document" ? (
                    a.satisfied ? (
                      <button type="button" className="text-[11px] text-primary hover:underline flex items-center gap-1"
                        onClick={() => onDownload({ id: a.documentId, fileName: a.documentName })}>
                        <Download className="w-3 h-3" /> {a.documentName ?? "View"}
                      </button>
                    ) : canUpload ? (
                      <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" disabled={busy} onClick={() => onUpload(a.docType)}>
                        <Upload className="w-3 h-3" /> Upload
                      </Button>
                    ) : null
                  ) : canTickActions ? (
                    <Button size="sm" variant={a.satisfied ? "ghost" : "outline"} className="h-6 text-[10px]" disabled={busy}
                      onClick={() => onToggleAction(a, !a.satisfied)}>
                      {a.satisfied ? "Undo" : "Mark done"}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {step.actionSummary?.blocking > 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              This step can&apos;t be completed until the {step.actionSummary.blocking} open item{step.actionSummary.blocking > 1 ? "s are" : " is"} cleared.
            </p>
          )}
        </section>
      )}

      {/* 3. Required documents not already itemised on the checklist */}
      {required.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> Required documents</h4>
          <ul className="space-y-1">
            {required.map((dt) => (
              <li key={dt} className="flex items-center justify-between gap-2">
                <span className={missing.has(dt) ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}>
                  {missing.has(dt) ? "○" : "✓"} {DOC_TYPE_LABELS[dt] ?? dt}
                </span>
                {missing.has(dt) && canUpload && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" disabled={busy} onClick={() => onUpload(dt)}><Upload className="w-3 h-3" /> Upload</Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 4. Proofs */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Upload className="w-3.5 h-3.5" /> Proofs</h4>
          {canUpload && <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" disabled={busy} onClick={() => onUpload("proof")}><Plus className="w-3 h-3" /> Add proof</Button>}
        </div>
        {proofs.length === 0 ? <p className="text-xs text-muted-foreground">No proof files attached.</p> : (
          <ul className="space-y-1">
            {proofs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{d.fileName}</span>
                <button type="button" className="text-primary hover:underline flex items-center gap-1 shrink-0" onClick={() => onDownload(d)}><Download className="w-3 h-3" /> Download</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 5. Billing — the single money record on a step */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Receipt className="w-3.5 h-3.5" /> Invoices</h4>
          {canBill && <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" disabled={busy} onClick={onCreateInvoice}><Plus className="w-3 h-3" /> New invoice</Button>}
        </div>
        {stepInvoices.length === 0 ? <p className="text-xs text-muted-foreground">No invoices from this step.</p> : (
          <ul className="space-y-1.5">
            {stepInvoices.map((inv) => {
              const pay = paymentStateOf(inv);
              return (
                <li key={inv.id} className="rounded-md border bg-background px-2 py-1.5 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {inv.referenceNo} · <span className={inv.kind === "payable" ? "text-orange-600 dark:text-orange-400" : "text-emerald-600 dark:text-emerald-400"}>{INVOICE_KIND_LABELS[inv.kind ?? "receivable"]}</span>
                    </span>
                    <Badge variant="outline" className={`text-[9px] shrink-0 ${PAYMENT_STATE_CLASS[pay.key] ?? ""}`}>{pay.label}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-muted-foreground">
                    <span className="font-medium text-foreground">{money(inv.totalAmount, inv.currency)}</span>
                    {pay.key !== "void" && pay.key !== "paid" && <span>{money(pay.outstanding, inv.currency)} outstanding</span>}
                  </div>
                  {(inv.lines ?? []).length > 0 && (
                    <ul className="space-y-0.5 pt-0.5 border-t text-[11px] text-muted-foreground">
                      {inv.lines.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-2">
                          <span className="truncate">{l.description} <span className="opacity-70">({Number(l.quantity)} × {money(l.unitPrice, inv.currency)})</span></span>
                          <span className="shrink-0">{money(l.amount, inv.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

/* ── Upload a document/proof scoped to a step. ── */
const StepUploadDialog = ({ busy, presetDocType, onClose, onSubmit }) => {
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState(presetDocType || "proof");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Upload to step</DialogTitle>
          <DialogDescription>Attach a required document or a proof file to this step.</DialogDescription></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (!file) return toast.error("Choose a file"); onSubmit({ file, docType }); }} className="space-y-4 py-2">
          <div className="space-y-1.5"><Label htmlFor="su-file">File</Label>
            <Input id="su-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} autoFocus /></div>
          <div className="space-y-1.5"><Label>Type</Label>
            <Select value={docType} onValueChange={setDocType} items={DOC_TYPE_OPTIONS}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Upload"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ── Create a payable/receivable invoice from a step. ── */
const CreateInvoiceDialog = ({ busy, defaultCurrency, vendors = [], onClose, onSubmit }) => {
  const [kind, setKind] = useState("receivable");
  const [vendorId, setVendorId] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency || DEFAULT_CURRENCY);
  const [lines, setLines] = useState([{ description: "", quantity: 1, unitPrice: "" }]);
  const setLine = (i, k, v) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((p) => [...p, { description: "", quantity: 1, unitPrice: "" }]);
  const removeLine = (i) => setLines((p) => p.filter((_, idx) => idx !== i));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);

  const submit = (e) => {
    e.preventDefault();
    if (kind === "payable" && !vendorId && !counterparty.trim()) return toast.error("A payable needs a vendor or counterparty (who we owe)");
    const clean = lines.filter((l) => l.description.trim() && l.unitPrice !== "" && Number(l.unitPrice) >= 0);
    if (!clean.length) return toast.error("Add at least one charge line with a price");
    onSubmit({
      kind,
      vendorId: kind === "payable" && vendorId ? vendorId : undefined,
      counterparty: kind === "payable" && !vendorId ? counterparty.trim() : undefined,
      currency,
      lines: clean.map((l, i) => ({ description: l.description.trim(), quantity: Number(l.quantity) || 1, unitPrice: Number(l.unitPrice), sortOrder: i })),
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>New invoice from step</DialogTitle>
          <DialogDescription>Receivable = the customer owes us; Payable = we owe a vendor/carrier.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Kind</Label>
              <Select value={kind} onValueChange={setKind} items={[{ value: "receivable", label: "Receivable" }, { value: "payable", label: "Payable" }]}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="receivable">Receivable (owed to us)</SelectItem>
                  <SelectItem value="payable">Payable (we owe)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="ci-ccy">Currency</Label>
              <Input id="ci-ccy" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
          </div>
          {kind === "payable" && (
            <div className="space-y-1.5"><Label>Vendor (who we owe)</Label>
              <Select value={vendorId || "none"} onValueChange={(v) => setVendorId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select a vendor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— free-text below —</SelectItem>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {!vendorId && <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="e.g. Maersk, ABC Trucking" />}
            </div>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label>Charge lines</Label>
              <Button type="button" size="sm" variant="outline" className="gap-1 h-8" onClick={addLine}><Plus className="w-3.5 h-3.5" /> Add line</Button></div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <Input className="col-span-6" placeholder="Description" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} />
                <Input className="col-span-2" type="number" min="0" step="0.01" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} />
                <Input className="col-span-3" type="number" min="0" step="0.01" placeholder="Unit price" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} />
                <button type="button" className="col-span-1 text-muted-foreground hover:text-destructive disabled:opacity-30" onClick={() => removeLine(i)} disabled={lines.length === 1} aria-label="Remove line"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <div className="text-right text-sm font-semibold">Total: {money(total, currency)}</div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create draft"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ShipmentDetailPage;
