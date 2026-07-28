import React, { useEffect, useState, useCallback } from "react";
import { Sun, Moon, LogOut, Ship, FileSearch, Receipt, Loader2, FileText, Plus, Check, X, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { useDashboardStore } from "@/store/dashboardStore";
import { useTheme } from "@/context/ThemeContext";
import {
  QUERY_STATUS_LABELS, QUOTATION_STATUS_LABELS, INVOICE_STATUS_LABELS,
  SERVICE_PACKAGE_OPTIONS, CRO_HANDLING_SHORT, labelForPackage,
  packageUsesPorts, packageUsesDestinationPort, packageHasCroChoice,
} from "@/lib/catalog";
import DocumentsPanel from "@/components/DocumentsPanel";
import { onSocket, joinRoom } from "@/lib/socket";
import * as queryService from "@/services/queryService";
import * as quotationService from "@/services/quotationService";
import * as financeService from "@/services/financeService";
import * as serviceCatalogService from "@/services/serviceCatalogService";

const money = (n, ccy) => `${ccy || "USD"} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

/**
 * Customer portal (CRM_MASTER §5.16). Own shipments, service requests (raise a
 * query, approve/reject a quote), published documents and invoices — never
 * internal notes, chat, margin or other customers.
 */
const UserDashboardPage = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { theme, toggleTheme } = useTheme();
  const { data, loading, fetchDashboard } = useDashboardStore();
  const [tab, setTab] = useState("shipments");
  const [docShipment, setDocShipment] = useState(null);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // Live tracking: join our customer room; shipment events are refetch hints.
  useEffect(() => {
    const leave = user?.customerId ? joinRoom("customer", user.customerId) : () => {};
    const offs = [
      onSocket("shipment:updated", () => fetchDashboard()),
      onSocket("shipment:stepCompleted", () => fetchDashboard()),
    ];
    return () => { offs.forEach((off) => off()); leave(); };
  }, [user?.customerId, fetchDashboard]);

  const handleLogout = () => { useAuthStore.getState().logout(); navigate("/"); };

  const k = data?.kind === "customer" ? data.kpis : null;
  const shipments = data?.kind === "customer" ? data.shipments : [];

  const TABS = [
    { key: "shipments", label: "Shipments", icon: Ship },
    { key: "requests", label: "Requests", icon: FileSearch },
    { key: "invoices", label: "Invoices", icon: Receipt },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-muted/40">
      <header className="h-14 flex items-center justify-between px-4 border-b bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="logo" className="w-7" />
          <h2 className="text-sm font-medium">Consort <span className="text-primary">Portal</span></h2>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleTheme} className="p-2 rounded-md hover:bg-muted transition" title="Toggle theme">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <AlertDialog>
            <AlertDialogTrigger render={<button className="p-2 rounded-md hover:bg-muted transition text-red-500" title="Logout"><LogOut size={18} /></button>} />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sign out?</AlertDialogTitle>
                <AlertDialogDescription>You will be returned to the login screen.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="gap-2">
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleLogout} className="bg-red-500 text-white hover:bg-red-600">Logout</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl w-full mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Welcome{user?.email ? `, ${user.email}` : ""}</h1>
          <p className="text-sm text-muted-foreground">Track your shipments and requests</p>
        </div>

        {loading && <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>}

        {k && (
          <>
            <div className="grid grid-cols-3 gap-4">
              <StatCard icon={Ship} label="Shipments" value={k.activeShipments} />
              <StatCard icon={FileSearch} label="Queries" value={Object.values(k.queries ?? {}).reduce((a, b) => a + b, 0)} />
              <StatCard icon={Receipt} label="Open invoices" value={k.openInvoices} />
            </div>

            <div className="flex gap-1 border-b">
              {TABS.map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition ${tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  <t.icon className="w-4 h-4" /> {t.label}
                </button>
              ))}
            </div>

            {tab === "shipments" && (
              <div className="space-y-3">
                <h2 className="font-semibold">Your shipments</h2>
                {shipments.length === 0 && (
                  <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-8 text-center text-muted-foreground text-sm">No shipments yet.</div>
                )}
                {shipments.map((s) => <ShipmentCard key={s.id} shipment={s} onDocuments={() => setDocShipment(s)} />)}
              </div>
            )}

            {tab === "requests" && <RequestsTab onChanged={fetchDashboard} />}
            {tab === "invoices" && <InvoicesTab />}
          </>
        )}
      </main>

      <Dialog open={!!docShipment} onOpenChange={(v) => !v && setDocShipment(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Documents · {docShipment?.referenceNo}</DialogTitle></DialogHeader>
          {docShipment && (
            <DocumentsPanel
              ownerType="shipment"
              ownerId={docShipment.id}
              portal
              // A customer supplying their own CRO has to be able to hand it over. The
              // server still enforces the docType allowlist and the CRO-mode check.
              allowUpload={docShipment.croHandledBy === "customer"}
              locked={["settled", "closed"].includes(docShipment.status) || docShipment.exceptionState === "cancelled"}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value }) => (
  <div className="border rounded-xl bg-white dark:bg-zinc-900 p-4 shadow-sm">
    <div className="flex items-center gap-2 text-muted-foreground text-sm"><Icon className="w-4 h-4" /> {label}</div>
    <p className="text-2xl font-semibold mt-1">{value}</p>
  </div>
);

/* ── Plain-language shipment tracker card ── */
const ShipmentCard = ({ shipment: s, onDocuments }) => {
  const [showTimeline, setShowTimeline] = useState(false);
  const done = s.progress?.done ?? 0;
  const total = s.progress?.total ?? 0;
  const delivered = total > 0 && done === total;
  const currentStep = (s.otdSteps ?? []).find((st) => st.status === "pending");
  const lane =
    s.servicePackage === "local_transport"
      ? [s.pickupAddress, s.deliveryAddress].filter(Boolean).join(" → ") || null
      : s.originPort && s.destinationPort
        ? `${s.originPort} → ${s.destinationPort}`
        : s.originPort || null;
  // The customer supplies the CRO on this shipment and we're still waiting for it.
  const awaitingCro =
    s.croHandledBy === "customer" &&
    (s.otdSteps ?? []).some((st) => st.stepCode === "cro_received_from_customer" && st.status !== "done");

  return (
    <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-primary">{s.referenceNo}</p>
            {lane && <span className="text-xs text-muted-foreground">{lane}</span>}
            {s.exceptionState === "on_hold" && (
              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300">
                On Hold — we're working on it
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            <Badge variant="secondary" className="text-[10px]">{labelForPackage(s.servicePackage)}</Badge>
            {s.croHandledBy && s.croHandledBy !== "not_applicable" && (
              <Badge variant="outline" className="text-[10px]">{CRO_HANDLING_SHORT[s.croHandledBy]}</Badge>
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 shrink-0" onClick={onDocuments}>
          <FileText className="w-3.5 h-3.5" /> Documents
        </Button>
      </div>

      {awaitingCro && (
        <div className="border rounded-md p-2.5 bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            <span className="font-medium">We're waiting on your CRO.</span> Upload the Container Release Order copy so we
            can collect your container.
          </p>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mt-2" onClick={onDocuments}>
            <FileText className="w-3.5 h-3.5" /> Upload CRO
          </Button>
        </div>
      )}

      {total > 0 && (
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, (done / total) * 100)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">Step {done} of {total}</p>
        </div>
      )}

      <p className="text-sm">
        {delivered ? <span className="font-medium text-green-600 dark:text-green-400">Delivered</span>
          : currentStep ? <>Current stage: <span className="font-medium">{currentStep.title}</span></>
          : null}
      </p>

      {s.eta && <p className="text-xs text-muted-foreground">Estimated arrival: {fmtDate(s.eta)}</p>}

      {(s.otdSteps ?? []).length > 0 && (
        <div>
          <button type="button" onClick={() => setShowTimeline((v) => !v)}
            className="text-xs text-primary font-medium flex items-center gap-1 hover:underline">
            {showTimeline ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showTimeline ? "Hide timeline" : "Show timeline"}
          </button>
          {showTimeline && (
            <ol className="mt-2 space-y-2 border-l pl-4 ml-1.5">
              {s.otdSteps.map((st) => (
                <li key={st.displayNo} className="flex items-start gap-2 text-sm">
                  {st.status === "done"
                    ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                    : <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0 mt-1.5 mx-1" />}
                  <span className={st.status === "done" ? "text-muted-foreground" : ""}>
                    {st.title}
                    {st.status === "done" && st.completedAt && (
                      <span className="text-xs text-muted-foreground"> · {fmtDate(st.completedAt)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Requests: queries + their quotations, raise new, approve/reject ── */
const RequestsTab = ({ onChanged }) => {
  const [queries, setQueries] = useState([]);
  const [quotesByQuery, setQuotesByQuery] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [rejectFor, setRejectFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [qs, quotes] = await Promise.all([queryService.listQueries(), quotationService.listQuotations()]);
      setQueries(qs.data ?? []);
      const map = {};
      for (const quote of quotes.data ?? []) {
        (map[quote.queryId] ??= []).push(quote);
      }
      setQuotesByQuery(map);
    } catch (err) {
      toast.error(err?.message || "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, msg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      await load();
      onChanged?.();
      setRejectFor(null);
    } catch (err) {
      toast.error(err?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const latestQuote = (queryId) => {
    const list = quotesByQuery[queryId] ?? [];
    return list.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold">Service requests</h2>
        <Button size="sm" className="gap-2" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" /> New request</Button>
      </div>

      {loading && <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      {!loading && queries.length === 0 && (
        <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-8 text-center text-muted-foreground text-sm">No requests yet — raise one to get a quote.</div>
      )}

      <div className="space-y-3">
        {queries.map((q) => {
          const quote = latestQuote(q.id);
          return (
            <div key={q.id} className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-primary">{q.referenceNo}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge variant="secondary" className="text-[10px]">{labelForPackage(q.servicePackage)}</Badge>
                    {q.croHandledBy && q.croHandledBy !== "not_applicable" && (
                      <Badge variant="outline" className="text-[10px]">{CRO_HANDLING_SHORT[q.croHandledBy]}</Badge>
                    )}
                  </div>
                  {q.servicePackage === "local_transport" ? (
                    (q.pickupAddress || q.deliveryAddress) && (
                      <p className="text-xs text-muted-foreground mt-1">{q.pickupAddress ?? "—"} → {q.deliveryAddress ?? "—"}</p>
                    )
                  ) : (
                    (q.originPort || q.destinationPort) && (
                      <p className="text-xs text-muted-foreground mt-1">{q.originPort ?? "—"} → {q.destinationPort ?? "—"}</p>
                    )
                  )}
                </div>
                <Badge variant="outline" className="text-xs">{QUERY_STATUS_LABELS[q.status] ?? q.status}</Badge>
              </div>

              {quote && (
                <div className="mt-3 pt-3 border-t flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm">
                    <span className="font-medium">{quote.referenceNo}</span>
                    <span className="text-muted-foreground"> · {money(quote.totalAmount, quote.currency)} · </span>
                    <Badge variant="outline" className="text-[10px]">{QUOTATION_STATUS_LABELS[quote.status] ?? quote.status}</Badge>
                  </div>
                  {quote.status === "sent" && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="h-8 text-xs gap-1" disabled={busy}
                        onClick={() => act(() => quotationService.approveQuotation(quote.id, quote.rowVersion), "Quote approved — your shipment is being set up")}>
                        <Check className="w-3.5 h-3.5" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1 text-destructive" disabled={busy}
                        onClick={() => setRejectFor(quote)}>
                        <X className="w-3.5 h-3.5" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showNew && <NewQueryDialog onClose={() => setShowNew(false)} onCreated={() => { load(); onChanged?.(); }} />}
      {rejectFor && (
        <RejectDialog busy={busy} onClose={() => setRejectFor(null)}
          onSubmit={(reason) => act(() => quotationService.rejectQuotation(rejectFor.id, reason), "Quote rejected")} />
      )}
    </div>
  );
};

/** A port picker over the reference-data port list. */
const PortSelect = ({ label, value, ports, onChange }) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    <Select
      value={value || "none"}
      onValueChange={(v) => onChange(v === "none" ? "" : v)}
      items={[{ value: "none", label: "—" }, ...ports.map((p) => ({ value: p.code, label: `${p.name} (${p.code})` }))]}
    >
      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">—</SelectItem>
        {ports.map((p) => <SelectItem key={p.code} value={p.code}>{p.name} ({p.code})</SelectItem>)}
      </SelectContent>
    </Select>
  </div>
);

/**
 * Raise a request, package first (CRM_MASTER §5.6a).
 *
 * The customer picks ONE of the three packages we sell; that choice presets the
 * underlying service codes server-side, decides which fields even make sense to ask
 * for, and — via /services/compose — lets us show the exact steps their shipment will
 * run before they commit. The raw six-service checkbox list this replaced was internal
 * vocabulary a customer should never have had to decode.
 */
const NewQueryDialog = ({ onClose, onCreated }) => {
  const [step, setStep] = useState(1); // 1 = pick a package, 2 = details
  const [servicePackage, setServicePackage] = useState(null);
  const [croHandledBy, setCroHandledBy] = useState("consort");
  const [ref, setRef] = useState({ ports: [], containerTypes: [] });
  const [form, setForm] = useState({
    originPort: "", destinationPort: "", pickupAddress: "", deliveryAddress: "",
    containerTypeCode: "", incoterm: "FOB", cargoDescription: "", weightKg: "",
  });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    serviceCatalogService.getReference().then((res) => setRef(res.data ?? { ports: [], containerTypes: [] })).catch(() => {});
  }, []);

  // Preview the composed path for the current package + CRO choice. This is what makes
  // the package concrete: "your shipment will run 8 steps", listed.
  useEffect(() => {
    if (!servicePackage) return undefined;
    let alive = true;
    serviceCatalogService
      .composeServices({ servicePackage, croHandledBy })
      .then((res) => { if (alive) setPreview(res.data ?? null); })
      .catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [servicePackage, croHandledBy]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const choosePackage = (code) => {
    setServicePackage(code);
    // Only Loading Point → Port offers the choice; the others are fixed.
    setCroHandledBy(code === "local_transport" ? "not_applicable" : "consort");
  };

  const usesPorts = packageUsesPorts(servicePackage);
  const needsDestPort = packageUsesDestinationPort(servicePackage);
  const isLocal = servicePackage === "local_transport";

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await queryService.createQuery({
        servicePackage,
        croHandledBy,
        // A local job travels between two addresses; a port job between port codes.
        originPort: usesPorts ? form.originPort || undefined : undefined,
        destinationPort: needsDestPort ? form.destinationPort || undefined : undefined,
        pickupAddress: form.pickupAddress || undefined,
        deliveryAddress: isLocal ? form.deliveryAddress || undefined : undefined,
        containerTypeCode: form.containerTypeCode || undefined,
        incoterm: usesPorts ? form.incoterm || undefined : undefined,
        cargoDescription: form.cargoDescription || undefined,
        weightKg: form.weightKg ? Number(form.weightKg) : undefined,
      });
      toast.success("Request submitted");
      await onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.message || "Could not submit request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New service request</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "What do you need us to do? Pick the service that matches your shipment."
              : `${labelForPackage(servicePackage)} — tell us the details and we'll quote it.`}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3 py-2">
            {SERVICE_PACKAGE_OPTIONS.map((p) => {
              const active = servicePackage === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => choosePackage(p.value)}
                  className={`w-full text-left border rounded-lg p-3 transition ${
                    active ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm">{p.label}</p>
                    {active && <Check className="w-4 h-4 text-primary shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{p.description}</p>
                  <ul className="mt-2 grid gap-0.5">
                    {p.includes.map((line) => (
                      <li key={line} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <Check className="w-3 h-3 mt-0.5 shrink-0 text-primary/70" /> {line}
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}

            {packageHasCroChoice(servicePackage) && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <Label className="text-sm">Container Release Order (CRO)</Label>
                <p className="text-xs text-muted-foreground">
                  A CRO is the shipping line's authority to collect an empty container. Do you already have one?
                </p>
                {["consort", "customer"].map((mode) => (
                  <label key={mode} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="croHandledBy"
                      className="mt-1"
                      checked={croHandledBy === mode}
                      onChange={() => setCroHandledBy(mode)}
                    />
                    <span>
                      {mode === "consort" ? "Consort should arrange the CRO" : "I will provide the CRO"}
                      <span className="block text-xs text-muted-foreground">
                        {mode === "consort"
                          ? "We apply to the shipping line on your behalf."
                          : "You'll upload your CRO copy here once the shipment is set up."}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {preview && (
              <div className="border rounded-lg p-3 bg-muted/30">
                <p className="text-sm font-medium">Your shipment will run {preview.stepCount} steps</p>
                <ol className="mt-2 space-y-1">
                  {preview.steps.map((s) => (
                    <li key={s.stepCode} className="text-xs text-muted-foreground">
                      {s.displayNo}. {s.title}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={!servicePackage} onClick={() => setStep(2)}>Continue</Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          <form onSubmit={submit} className="space-y-4 py-2">
            {/* Local jobs move between two addresses — no ports, no incoterm. */}
            {isLocal && (
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pickup">Pickup address</Label>
                  <Input id="pickup" required value={form.pickupAddress}
                    onChange={(e) => set("pickupAddress", e.target.value)}
                    placeholder="Where should we collect from?" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="delivery">Delivery address</Label>
                  <Input id="delivery" required value={form.deliveryAddress}
                    onChange={(e) => set("deliveryAddress", e.target.value)}
                    placeholder="Where should we deliver to?" />
                </div>
              </div>
            )}

            {usesPorts && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="pickup2">Loading point / factory address</Label>
                  <Input id="pickup2" value={form.pickupAddress}
                    onChange={(e) => set("pickupAddress", e.target.value)}
                    placeholder="Where should we collect the cargo?" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <PortSelect
                    label={needsDestPort ? "Origin port" : "Port of handover"}
                    value={form.originPort}
                    ports={ref.ports}
                    onChange={(v) => set("originPort", v)}
                  />
                  {needsDestPort && (
                    <PortSelect
                      label="Destination port"
                      value={form.destinationPort}
                      ports={ref.ports}
                      onChange={(v) => set("destinationPort", v)}
                    />
                  )}
                  <div className="space-y-1.5">
                    <Label>Container</Label>
                    <Select value={form.containerTypeCode || "none"} onValueChange={(v) => set("containerTypeCode", v === "none" ? "" : v)}
                      items={[{ value: "none", label: "—" }, ...ref.containerTypes.map((c) => ({ value: c.code, label: c.label }))]}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {ref.containerTypes.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inco">Incoterm</Label>
                    <Input id="inco" value={form.incoterm} onChange={(e) => set("incoterm", e.target.value)} />
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cargo">Cargo description</Label>
                <Input id="cargo" value={form.cargoDescription} onChange={(e) => set("cargoDescription", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="weight">Weight (kg)</Label>
                <Input id="weight" type="number" min="0" step="any" value={form.weightKg}
                  onChange={(e) => set("weightKg", e.target.value)} />
              </div>
            </div>

            {croHandledBy === "customer" && (
              <p className="text-xs text-muted-foreground border rounded-md p-2 bg-muted/30">
                You've chosen to provide the CRO. Once your quote is approved you'll be able to upload the CRO copy from
                your shipment's Documents panel.
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={busy}>Back</Button>
              <Button type="submit" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit request"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

const RejectDialog = ({ busy, onClose, onSubmit }) => {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Reject quotation</DialogTitle>
          <DialogDescription>Tell us why — this requests a revision.</DialogDescription></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 3) return toast.error("A reason is required"); onSubmit(reason.trim()); }} className="space-y-4 py-2">
          <div className="space-y-1.5"><Label htmlFor="rej">Reason</Label>
            <Input id="rej" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy} className="bg-destructive text-white hover:bg-destructive/90">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reject"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ── Invoices: own, read-only ── */
const InvoicesTab = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    financeService.listInvoices()
      .then((res) => setInvoices(res.data ?? []))
      .catch((err) => toast.error(err?.message || "Failed to load invoices"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5">
      <h2 className="font-semibold mb-3">Your invoices</h2>
      {invoices.length === 0 && <p className="text-sm text-muted-foreground">No invoices yet.</p>}
      <ul className="divide-y">
        {invoices.map((inv) => {
          const paid = (inv.payments ?? []).reduce((a, p) => a + Number(p.amount ?? 0), 0);
          return (
            <li key={inv.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-primary">{inv.referenceNo}</p>
                <p className="text-xs text-muted-foreground">{money(inv.totalAmount, inv.currency)}{paid > 0 && inv.status !== "paid" ? ` · paid ${money(paid, inv.currency)}` : ""}</p>
              </div>
              <Badge variant="outline" className="text-xs">{INVOICE_STATUS_LABELS[inv.status] ?? inv.status}</Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default UserDashboardPage;
