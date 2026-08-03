import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FileSearch, RefreshCw, AlertCircle, Plus, Loader2, XCircle, Flame, Snowflake, FileText, Send, Trash2, CheckCircle2, Check, X, Eye, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useQueryStore } from "@/store/queryStore";
import { useQuotationStore } from "@/store/quotationStore";
// Read-only: DecideQuoteDialog looks up the one live quote for a query. All quotation
// WRITES go through useQuotationStore so they invalidate the screens they affect.
import * as quotationService from "@/services/quotationService";
import { useCustomerStore } from "@/store/customerStore";
import { useAuthStore } from "@/store/authStore";
import * as serviceCatalogService from "@/services/serviceCatalogService";
import {
  SERVICE_OPTIONS, labelForService, QUERY_STATUS_LABELS,
  SERVICE_PACKAGE_OPTIONS, PACKAGE_PRESET_SERVICES, CRO_HANDLING_LABELS, CRO_HANDLING_SHORT,
  LC_HANDLING_LABELS, LC_HANDLING_SHORT, packageHasLcChoice, packageHasDownstreamToggle,
  labelForPackage, packageUsesPorts, packageUsesDestinationPort, packageHasCroChoice,
  packageUsesDeliveryAddress, packageUsesImportTerms, routeOf, DEFAULT_CURRENCY,
} from "@/lib/catalog";
import { quoteTemplateFor } from "@/lib/quoteTemplates";
import QueryLcDetails from "./QueryLcDetails";

const STATUS_STYLES = {
  open: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-300",
  quoted: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300",
  revision_requested: "bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-300",
  shipment_created: "bg-green-50 text-green-700 border-green-400 dark:bg-green-950/30 dark:text-green-300",
  cancelled: "bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300",
  expired: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300",
};

/** Statuses a query can still be quoted from (mirrors quotation.service). */
const QUOTABLE = ["open", "quoted", "revision_requested"];

const money = (n, ccy) =>
  `${ccy || DEFAULT_CURRENCY} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/**
 * QueriesListPage — shipping requests carrying the SELECTED SERVICES that
 * later compose the shipment's OTD path (CRM_MASTER §5.6/§5.6a, ADR-040/041).
 */
const QueriesListPage = () => {
  const { queries, loading, error, busy, filters, setFilter, fetchQueries, createQuery, cancelQuery } = useQueryStore();
  const { createQuotation, sendQuotation, approveQuotation, rejectQuotation } = useQuotationStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const location = useLocation();
  const navigate = useNavigate();

  // Customers page can deep-link here with a preselected customer.
  const [addOpen, setAddOpen] = useState(!!location.state?.customerId);
  const [cancelFor, setCancelFor] = useState(null);
  const [quoteFor, setQuoteFor] = useState(null);
  const [decideFor, setDecideFor] = useState(null);
  const [detailFor, setDetailFor] = useState(null);

  useEffect(() => { fetchQueries(); }, [fetchQueries]);

  // The stores own the refetch and the cross-screen invalidation. Approving here creates
  // a shipment and composes its OTD path (RULE-QT-07), which is why this used to be one of
  // the worst reload traps in the app: the Quotations list still read `sent` and the
  // Shipments list had no new shipment.
  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      setAddOpen(false);
      setCancelFor(null);
      setQuoteFor(null);
      setDecideFor(null);
    } catch (err) {
      toast.error(err?.message || "Couldn't update the query");
    }
  };

  /**
   * Quote straight from the query row — Ops doesn't have to re-find the query
   * on the Quotations page. Drafts, then sends in the same click when the user
   * is allowed to send (ops_exec drafts; ops_manager drafts + sends).
   */
  const giveQuote = (payload, alsoSend) =>
    act(async () => {
      const res = await createQuotation(payload);
      if (!alsoSend) return { message: "Quotation drafted — an Ops Manager sends it to the customer" };
      await sendQuotation(res.data.id);
      return { message: `${res.data.referenceNo} sent to the customer` };
    });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><FileSearch className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Queries</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Shipping requests — the selected services drive everything downstream
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={filters.status || "all"} onValueChange={(v) => setFilter("status", v === "all" ? "" : v)} items={[{ value: "all", label: "All statuses" }, ...Object.entries(QUERY_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(QUERY_STATUS_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchQueries} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {hasPermission("query.create") && (
            <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" /> New Query
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium flex-1">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchQueries} className="border-destructive/50 text-destructive hover:bg-destructive/10">Retry</Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-xl overflow-x-auto bg-white dark:bg-zinc-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left border-b">
            <tr>
              <th className="p-3 font-semibold text-muted-foreground">Ref</th>
              <th className="p-3 font-semibold text-muted-foreground">Customer</th>
              <th className="p-3 font-semibold text-muted-foreground">Services</th>
              <th className="p-3 font-semibold text-muted-foreground hidden md:table-cell">Route</th>
              <th className="p-3 font-semibold text-muted-foreground">Status</th>
              <th className="p-3 font-semibold text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && [...Array(3)].map((_, i) => (
              <tr key={i} className="border-t animate-pulse">
                {[...Array(6)].map((_, j) => <td key={j} className="p-3"><div className="h-4 bg-muted rounded w-3/4" /></td>)}
              </tr>
            ))}

            {!loading && queries.map((q) => (
              <tr key={q.id} className="border-t hover:bg-muted/30 transition-colors group">
                <td className="p-3">
                  <span className="font-medium text-primary">{q.referenceNo}</span>
                  <span className="ml-1.5 inline-flex gap-1 align-middle">
                    {q.isHazardous && <Flame className="w-3.5 h-3.5 text-red-500" title="Hazardous" />}
                    {q.isReefer && <Snowflake className="w-3.5 h-3.5 text-sky-500" title="Reefer" />}
                    {/* Priced against a credit, not just a lane — worth seeing in the list. */}
                    {q.lcDetails && <Landmark className="w-3.5 h-3.5 text-primary" title={`LC ${q.lcDetails.lcNumber ?? ""}`} />}
                  </span>
                </td>
                <td className="p-3">
                  <span className="font-medium">{q.customerCompany}</span>{" "}
                  <span className="text-xs text-muted-foreground">({q.customerRef})</span>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1 max-w-xs">
                    {q.services.map((s) => (
                      <Badge key={s} variant="secondary" className="text-[10px]">{labelForService(s)}</Badge>
                    ))}
                  </div>
                </td>
                <td className="p-3 text-muted-foreground hidden md:table-cell">
                  {[q.originPort, q.destinationPort].filter(Boolean).join(" → ") || "—"}
                </td>
                <td className="p-3">
                  <Badge variant="outline" className={`text-xs ${STATUS_STYLES[q.status] ?? ""}`}>
                    {QUERY_STATUS_LABELS[q.status]}
                  </Badge>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs gap-1"
                    onClick={() => setDetailFor(q)}
                  >
                    <Eye className="w-3.5 h-3.5" /> Details
                  </Button>
                  {QUOTABLE.includes(q.status) && hasPermission("quotation.create") && (
                    <Button
                      size="sm"
                      className="h-8 px-2.5 text-xs gap-1"
                      onClick={() => setQuoteFor(q)}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {q.status === "revision_requested" ? "Re-quote" : "Give Quote"}
                    </Button>
                  )}
                  {q.status === "quoted" && hasPermission("quotation.approve") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 text-xs gap-1 ml-1"
                      onClick={() => setDecideFor(q)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Review Quote
                    </Button>
                  )}
                  {["open", "quoted", "revision_requested"].includes(q.status) && hasPermission("query.cancel") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-xs gap-1 ml-1 opacity-70 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setCancelFor(q)}
                    >
                      <XCircle className="w-3.5 h-3.5" /> Cancel
                    </Button>
                  )}
                </td>
              </tr>
            ))}

            {!loading && queries.length === 0 && !error && (
              <tr>
                <td colSpan="6" className="p-10 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FileSearch className="w-8 h-8 opacity-30" />
                    <p className="font-medium">No queries yet</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {addOpen && (
        <AddQueryDialog
          busy={busy}
          presetCustomerId={location.state?.customerId}
          onClose={() => { setAddOpen(false); navigate(location.pathname, { replace: true, state: null }); }}
          onSubmit={(payload) => act(() => createQuery(payload), "Query created")}
        />
      )}
      {quoteFor && (
        <GiveQuoteDialog
          busy={busy}
          query={quoteFor}
          canSend={hasPermission("quotation.send")}
          onClose={() => setQuoteFor(null)}
          onSubmit={giveQuote}
        />
      )}
      {decideFor && (
        <DecideQuoteDialog
          busy={busy}
          query={decideFor}
          onClose={() => setDecideFor(null)}
          onApprove={(quote) =>
            act(
              () => approveQuotation(quote.id, quote.rowVersion),
              `Quote ${quote.referenceNo} approved — the shipment is being created`,
            )
          }
          onReject={(quote, reason) =>
            act(() => rejectQuotation(quote.id, reason), "Quote rejected — Ops can revise it")
          }
        />
      )}
      {cancelFor && (
        <CancelQueryDialog
          busy={busy}
          query={cancelFor}
          onClose={() => setCancelFor(null)}
          onSubmit={(reason) => act(() => cancelQuery(cancelFor.id, reason), "Query cancelled")}
        />
      )}
      {detailFor && <QueryDetailDialog query={detailFor} onClose={() => setDetailFor(null)} />}
    </div>
  );
};

/* ── Query detail — what was asked for, and the LC it was asked against ── */
const QueryDetailDialog = ({ query: q, onClose }) => (
  <Dialog open onOpenChange={(v) => !v && onClose()}>
    <DialogContent size="xl" className="overflow-hidden">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {q.referenceNo}
          <Badge variant="outline" className={`text-xs ${STATUS_STYLES[q.status] ?? ""}`}>
            {QUERY_STATUS_LABELS[q.status]}
          </Badge>
        </DialogTitle>
        <DialogDescription>
          {q.customerCompany} ({q.customerRef}) · raised by {q.raisedByName}
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-1 -mx-1 pb-1 scrollbar-thin">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
          <div className="col-span-full">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Services</dt>
            <dd className="flex flex-wrap gap-1 mt-1">
              {q.services.map((s) => <Badge key={s} variant="secondary" className="text-[10px]">{labelForService(s)}</Badge>)}
            </dd>
          </div>
          {[
            ["Package", q.servicePackage ? labelForPackage(q.servicePackage) : null],
            ["Route", routeOf(q) || [q.originPort, q.destinationPort].filter(Boolean).join(" → ")],
            ["Incoterm", q.incoterm],
            ["Cargo", q.cargoDescription],
            ["Weight", q.weightKg != null ? `${Number(q.weightKg).toLocaleString()} kg` : null],
            ["Container", q.containerTypeCode],
            ["CRO handling", q.croHandledBy && q.croHandledBy !== "not_applicable" ? CRO_HANDLING_LABELS[q.croHandledBy] : null],
            ["LC handling", q.lcHandledBy && q.lcHandledBy !== "not_applicable" ? LC_HANDLING_LABELS[q.lcHandledBy] : null],
            ["Pickup", q.pickupAddress],
            ["Delivery", q.deliveryAddress],
            ["Free days", q.freeDays != null ? `${q.freeDays} days` : null],
            ["Empty return", q.emptyReturnLocation],
            ["Cancelled because", q.cancelReason],
          ].filter(([, v]) => v).map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium break-words">{value}</dd>
            </div>
          ))}
          {(q.isHazardous || q.isReefer) && (
            <div className="col-span-full flex gap-1.5">
              {q.isHazardous && <Badge variant="outline" className="text-[10px] border-red-400 text-red-600 gap-1"><Flame className="w-3 h-3" /> Hazardous</Badge>}
              {q.isReefer && <Badge variant="outline" className="text-[10px] border-sky-400 text-sky-600 gap-1"><Snowflake className="w-3 h-3" /> Reefer</Badge>}
            </div>
          )}
        </dl>

        <QueryLcDetails query={q} />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/* ── New query — service multi-select is the core (RULE-QRY-05) ── */
const AddQueryDialog = ({ busy, presetCustomerId, onClose, onSubmit }) => {
  const { customers, fetchCustomers } = useCustomerStore();
  const [ref, setRef] = useState({ ports: [], containerTypes: [] });
  const [form, setForm] = useState({
    customerId: presetCustomerId ?? "",
    servicePackage: "",
    croHandledBy: "consort",
    lcHandledBy: "not_applicable",
    // Additive extras ON TOP of the package preset — Ops fine-tune, not the whole set.
    extraServices: [],
    originPort: "",
    destinationPort: "",
    pickupAddress: "",
    deliveryAddress: "",
    freeDays: "",
    emptyReturnLocation: "",
    containerTypeCode: "",
    incoterm: "",
    cargoDescription: "",
    weightKg: "",
    isHazardous: false,
    isReefer: false,
  });

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);
  useEffect(() => {
    serviceCatalogService.getReference().then((res) => setRef(res.data ?? { ports: [], containerTypes: [] })).catch(() => {});
  }, []);

  const toggleService = (code) =>
    setForm((p) => ({
      ...p,
      extraServices: p.extraServices.includes(code)
        ? p.extraServices.filter((s) => s !== code)
        : [...p.extraServices, code],
    }));

  const choosePackage = (code) =>
    setForm((p) => ({
      ...p,
      servicePackage: code,
      croHandledBy: packageHasCroChoice(code) || code === "international" ? "consort" : "not_applicable",
      // A bank-LC customer's trade is LC-financed by definition, so default their LC
      // to Consort-managed (the server coerces the same way — RULE-SVC-04/ADR-050).
      lcHandledBy:
        packageHasLcChoice(code) && selectedCustomer?.source === "bank_lc" ? "consort" : "not_applicable",
      // Clear the fields the new package cannot carry.
      ...(code === "local_transport" ? { originPort: "", destinationPort: "", incoterm: "" } : {}),
      ...(code === "loading_point_to_port" ? { destinationPort: "" } : {}),
      // Import delivery starts AT the terminal, so there is no loading point and no
      // destination port; free days only mean anything here.
      ...(code === "port_to_consignee" ? { destinationPort: "", pickupAddress: "" } : { freeDays: "", emptyReturnLocation: "" }),
    }));

  const selectedCustomer = customers.find((c) => c.id === form.customerId);
  const pkg = form.servicePackage;
  const usesPorts = packageUsesPorts(pkg);
  const needsDestPort = packageUsesDestinationPort(pkg);
  const isLocal = pkg === "local_transport";
  const isImport = packageUsesImportTerms(pkg);
  // The services the package will preset server-side, shown read-only so Ops can see
  // what they're adding to.
  const presetServices = PACKAGE_PRESET_SERVICES[pkg] ?? [];

  const submit = (e) => {
    e.preventDefault();
    if (!form.customerId) return toast.error("Pick a customer");
    if (!pkg) return toast.error("Pick a service package");
    onSubmit({
      customerId: form.customerId,
      servicePackage: pkg,
      croHandledBy: form.croHandledBy,
      lcHandledBy: packageHasLcChoice(pkg) ? form.lcHandledBy : undefined,
      services: form.extraServices.length ? form.extraServices : undefined,
      originPort: usesPorts ? form.originPort || undefined : undefined,
      destinationPort: needsDestPort ? form.destinationPort || undefined : undefined,
      pickupAddress: isImport ? undefined : form.pickupAddress || undefined,
      deliveryAddress: packageUsesDeliveryAddress(pkg) ? form.deliveryAddress || undefined : undefined,
      freeDays: isImport && form.freeDays !== "" ? Number(form.freeDays) : undefined,
      emptyReturnLocation: isImport ? form.emptyReturnLocation || undefined : undefined,
      containerTypeCode: form.containerTypeCode || undefined,
      incoterm: usesPorts ? form.incoterm || undefined : undefined,
      cargoDescription: form.cargoDescription || undefined,
      weightKg: form.weightKg ? Number(form.weightKg) : undefined,
      isHazardous: form.isHazardous,
      isReefer: form.isReefer,
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Query</DialogTitle>
          <DialogDescription>
            The service package composes the shipment's step path later — Local Transport
            gets the short trucking path, International the full one.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Select value={form.customerId} onValueChange={(v) => setForm((p) => ({ ...p, customerId: v }))} items={customers.filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.referenceNo} — ${c.companyName}` }))}>
              <SelectTrigger><SelectValue placeholder="Select customer…" /></SelectTrigger>
              <SelectContent>
                {customers.filter((c) => c.isActive).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.referenceNo} — {c.companyName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCustomer?.source === "bank_lc" && (
              <p className="text-xs text-primary">
                Bank-LC customer — LC / Trade Finance is included automatically.
              </p>
            )}
          </div>

          {/* Service package — presets the ServiceCode set server-side */}
          <div className="space-y-1.5">
            <Label>Service package</Label>
            <Select value={pkg} onValueChange={choosePackage}
              items={SERVICE_PACKAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}>
              <SelectTrigger><SelectValue placeholder="Select a package…" /></SelectTrigger>
              <SelectContent>
                {SERVICE_PACKAGE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {pkg && (
              <p className="text-xs text-muted-foreground">
                Includes: {presetServices.map(labelForService).join(", ")}
              </p>
            )}
          </div>

          {/* CRO sub-option — only Loading Point → Port offers the choice */}
          {packageHasCroChoice(pkg) && (
            <div className="space-y-1.5">
              <Label>Container Release Order</Label>
              <Select value={form.croHandledBy} onValueChange={(v) => setForm((p) => ({ ...p, croHandledBy: v }))}
                items={[
                  { value: "consort", label: CRO_HANDLING_LABELS.consort },
                  { value: "customer", label: CRO_HANDLING_LABELS.customer },
                ]}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="consort">{CRO_HANDLING_LABELS.consort}</SelectItem>
                  <SelectItem value="customer">{CRO_HANDLING_LABELS.customer}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.croHandledBy === "customer"
                  ? "The customer uploads their CRO copy from the portal; we don't apply to the line."
                  : "We apply to the shipping line — the CRO application doc pack will be required."}
              </p>
            </div>
          )}

          {/* LC sub-option (ADR-050) — both export packages ask who manages the LC */}
          {packageHasLcChoice(pkg) && (
            <div className="space-y-1.5">
              <Label>Letter of Credit</Label>
              <Select value={form.lcHandledBy} onValueChange={(v) => setForm((p) => ({ ...p, lcHandledBy: v }))}
                items={[
                  { value: "not_applicable", label: LC_HANDLING_LABELS.not_applicable },
                  { value: "customer", label: LC_HANDLING_LABELS.customer },
                  { value: "consort", label: LC_HANDLING_LABELS.consort },
                ]}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_applicable">{LC_HANDLING_LABELS.not_applicable}</SelectItem>
                  <SelectItem value="customer">{LC_HANDLING_LABELS.customer}</SelectItem>
                  <SelectItem value="consort">{LC_HANDLING_LABELS.consort}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.lcHandledBy === "customer"
                  ? "The customer runs the LC with their bank — we'll chase them for the LC copy."
                  : form.lcHandledBy === "consort"
                    ? "We manage the LC end-to-end — LC / Trade Finance is added to the services."
                    : "Open-account trade — no LC steps will be composed."}
              </p>
              {selectedCustomer?.source === "bank_lc" && form.lcHandledBy === "not_applicable" && (
                <p className="text-xs text-amber-600">
                  Bank-LC customer — the server will default this to Consort-managed unless the customer provides the LC.
                </p>
              )}
            </div>
          )}

          {/* Downstream add-on (ADR-050) — international only: the destination agent's
              DO / pickup / empty-return leg, driven by the destination_services code */}
          {packageHasDownstreamToggle(pkg) && (
            <label className="flex items-start gap-2 text-sm cursor-pointer border rounded-lg p-3">
              <Checkbox
                checked={form.extraServices.includes("destination_services")}
                onCheckedChange={() => toggleService("destination_services")}
              />
              <span>
                Add destination delivery (Downstream)
                <span className="block text-xs text-muted-foreground font-normal">
                  Our destination agent obtains the delivery order & gate pass, picks the container up,
                  delivers to the consignee and returns the empty.
                </span>
              </span>
            </label>
          )}

          {/* Additive extras on top of the package preset (ADR-041 catalog). The
              destination add-on has its own toggle above on international, so it is
              filtered out here rather than rendered twice. */}
          {pkg && (
            <div className="space-y-1.5">
              <Label>Add-on services <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border rounded-lg p-3">
                {SERVICE_OPTIONS.filter(
                  (s) =>
                    !presetServices.includes(s.value) &&
                    !(packageHasDownstreamToggle(pkg) && s.value === "destination_services"),
                ).map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={form.extraServices.includes(s.value)}
                      onCheckedChange={() => toggleService(s.value)}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Local jobs move door to door; port jobs use reference port codes. */}
          {isLocal ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="q-pickup">Pickup address</Label>
                <Input id="q-pickup" required value={form.pickupAddress} onChange={(e) => setForm((p) => ({ ...p, pickupAddress: e.target.value }))} placeholder="Collection point" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-deliv">Delivery address</Label>
                <Input id="q-deliv" required value={form.deliveryAddress} onChange={(e) => setForm((p) => ({ ...p, deliveryAddress: e.target.value }))} placeholder="Delivery point" />
              </div>
            </div>
          ) : isImport ? (
            /* Import delivery runs port → door: a terminal code out, a street address in. */
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Port / terminal holding the container</Label>
                  <Select value={form.originPort || "none"} onValueChange={(v) => setForm((p) => ({ ...p, originPort: v === "none" ? "" : v }))}
                    items={[{ value: "none", label: "—" }, ...ref.ports.map((p) => ({ value: p.code, label: `${p.name} (${p.code})` }))]}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {ref.ports.map((p) => <SelectItem key={p.code} value={p.code}>{p.name} ({p.code})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="q-consignee">Consignee delivery address</Label>
                  <Input id="q-consignee" required value={form.deliveryAddress} onChange={(e) => setForm((p) => ({ ...p, deliveryAddress: e.target.value }))} placeholder="Where the container is delivered" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="q-freedays">Free days <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input id="q-freedays" type="number" min="0" max="365" value={form.freeDays} onChange={(e) => setForm((p) => ({ ...p, freeDays: e.target.value }))} placeholder="e.g. 7" />
                  <p className="text-[11px] text-muted-foreground">Detention-free window the line granted the consignee.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="q-return">Empty return location <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input id="q-return" value={form.emptyReturnLocation} onChange={(e) => setForm((p) => ({ ...p, emptyReturnLocation: e.target.value }))} placeholder="Dry port / yard address" />
                </div>
              </div>
            </>
          ) : usesPorts ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="q-pickup2">Loading point address <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="q-pickup2" value={form.pickupAddress} onChange={(e) => setForm((p) => ({ ...p, pickupAddress: e.target.value }))} placeholder="Factory / loading point" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* Selects, not free text — the API validates these against the Port table. */}
                <div className="space-y-1.5">
                  <Label>{needsDestPort ? "Origin Port" : "Port of handover"}</Label>
                  <Select value={form.originPort || "none"} onValueChange={(v) => setForm((p) => ({ ...p, originPort: v === "none" ? "" : v }))}
                    items={[{ value: "none", label: "—" }, ...ref.ports.map((p) => ({ value: p.code, label: `${p.name} (${p.code})` }))]}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {ref.ports.map((p) => <SelectItem key={p.code} value={p.code}>{p.name} ({p.code})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {needsDestPort && (
                  <div className="space-y-1.5">
                    <Label>Destination Port</Label>
                    <Select value={form.destinationPort || "none"} onValueChange={(v) => setForm((p) => ({ ...p, destinationPort: v === "none" ? "" : v }))}
                      items={[{ value: "none", label: "—" }, ...ref.ports.map((p) => ({ value: p.code, label: `${p.name} (${p.code})` }))]}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {ref.ports.map((p) => <SelectItem key={p.code} value={p.code}>{p.name} ({p.code})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </>
          ) : null}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Container</Label>
              <Select value={form.containerTypeCode || "none"} onValueChange={(v) => setForm((p) => ({ ...p, containerTypeCode: v === "none" ? "" : v }))}
                items={[{ value: "none", label: "—" }, ...ref.containerTypes.map((c) => ({ value: c.code, label: c.label }))]}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {ref.containerTypes.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {usesPorts && (
              <div className="space-y-1.5">
                <Label htmlFor="q-incoterm">Incoterm</Label>
                <Input id="q-incoterm" value={form.incoterm} onChange={(e) => setForm((p) => ({ ...p, incoterm: e.target.value }))} placeholder="FOB" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="q-weight">Weight (kg)</Label>
              <Input id="q-weight" type="number" min="0" value={form.weightKg} onChange={(e) => setForm((p) => ({ ...p, weightKg: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="q-cargo">Cargo Description</Label>
            <Input id="q-cargo" value={form.cargoDescription} onChange={(e) => setForm((p) => ({ ...p, cargoDescription: e.target.value }))} placeholder="Optional" />
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={form.isHazardous} onCheckedChange={(v) => setForm((p) => ({ ...p, isHazardous: !!v }))} />
              <Flame className="w-4 h-4 text-red-500" /> Hazardous
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={form.isReefer} onCheckedChange={(v) => setForm((p) => ({ ...p, isReefer: !!v }))} />
              <Snowflake className="w-4 h-4 text-sky-500" /> Reefer
            </label>
          </div>
          {(form.isHazardous || form.isReefer) && (
            <p className="text-xs text-amber-600">A Compliance pre-check task will be created automatically.</p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create Query
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ── Give Quote — draft (and optionally send) a quotation without leaving the
      queries list. Charge lines are pre-seeded from a PACKAGE template (see
      lib/quoteTemplates.js) plus a line for any add-on service the template doesn't
      cover, so Ops only fills in prices. Totals are recomputed server-side regardless
      of what we send (RULE-QT-02). ── */
const GiveQuoteDialog = ({ busy, query, canSend, onClose, onSubmit }) => {
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [validityDate, setValidityDate] = useState("");
  const [lines, setLines] = useState(() =>
    quoteTemplateFor({
      servicePackage: query.servicePackage,
      croHandledBy: query.croHandledBy,
      // Anything selected beyond what the package presets is an Ops add-on.
      extraServices: (query.services ?? []).filter(
        (s) => !(PACKAGE_PRESET_SERVICES[query.servicePackage] ?? []).includes(s),
      ),
    })
  );

  const setLine = (i, key, val) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));
  const addLine = () => setLines((p) => [...p, { description: "", quantity: 1, unitPrice: "" }]);
  const removeLine = (i) => setLines((p) => p.filter((_, idx) => idx !== i));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);

  const build = () => {
    const clean = lines.filter((l) => l.description.trim() && l.unitPrice !== "" && Number(l.unitPrice) >= 0);
    if (!clean.length) {
      toast.error("Add at least one charge line with a price");
      return null;
    }
    return {
      queryId: query.id,
      currency,
      validityDate: validityDate || undefined,
      chargeLines: clean.map((l, i) => ({
        service: l.service,
        // Carried through so resolveCharge() places the charge on the right OTD step.
        chargeCode: l.chargeCode,
        description: l.description.trim(),
        quantity: Number(l.quantity) || 1,
        unitPrice: Number(l.unitPrice),
        sortOrder: i,
      })),
    };
  };

  const submit = (e, alsoSend = false) => {
    e.preventDefault();
    const payload = build();
    if (payload) onSubmit(payload, alsoSend);
  };

  const route = routeOf(query);

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Quote {query.referenceNo}</DialogTitle>
          <DialogDescription>
            {query.customerCompany}
            {route ? ` · ${route}` : ""} — price each service below. Approval by the
            customer starts the shipment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 py-2">
          {/* What the customer asked for */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
            <div className="flex flex-wrap gap-1">
              {query.servicePackage && <Badge className="text-[10px]">{labelForPackage(query.servicePackage)}</Badge>}
              {query.croHandledBy && query.croHandledBy !== "not_applicable" && (
                <Badge variant="outline" className="text-[10px]">{CRO_HANDLING_SHORT[query.croHandledBy]}</Badge>
              )}
              {query.lcHandledBy && query.lcHandledBy !== "not_applicable" && (
                <Badge variant="outline" className="text-[10px]">{LC_HANDLING_SHORT[query.lcHandledBy]}</Badge>
              )}
              {(query.services ?? []).map((s) => (
                <Badge key={s} variant="secondary" className="text-[10px]">{labelForService(s)}</Badge>
              ))}
              {query.isHazardous && <Badge variant="outline" className="text-[10px] text-red-600 border-red-300">Hazardous</Badge>}
              {query.isReefer && <Badge variant="outline" className="text-[10px] text-sky-600 border-sky-300">Reefer</Badge>}
            </div>
            {query.croHandledBy === "customer" && (
              <p className="text-xs text-muted-foreground">
                The customer is supplying their own CRO — no CRO charge line is pre-seeded.
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {query.containerTypeCode && <span>Container: <b className="text-foreground">{query.containerTypeCode}</b></span>}
              {query.incoterm && <span>Incoterm: <b className="text-foreground">{query.incoterm}</b></span>}
              {query.weightKg != null && <span>Weight: <b className="text-foreground">{Number(query.weightKg).toLocaleString()} kg</b></span>}
            </div>
            {query.cargoDescription && (
              <p className="text-xs text-muted-foreground">Cargo: {query.cargoDescription}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gq-ccy">Currency</Label>
              <Input id="gq-ccy" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gq-validity">Valid until (optional)</Label>
              <Input id="gq-validity" type="date" value={validityDate} onChange={(e) => setValidityDate(e.target.value)} />
            </div>
          </div>

          {/* Charge lines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Charge lines</Label>
              <Button type="button" size="sm" variant="outline" className="gap-1 h-8" onClick={addLine}>
                <Plus className="w-3.5 h-3.5" /> Add line
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <Input
                    className="col-span-6"
                    placeholder="Description"
                    value={l.description}
                    onChange={(e) => setLine(i, "description", e.target.value)}
                  />
                  <Input
                    className="col-span-2"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Qty"
                    value={l.quantity}
                    onChange={(e) => setLine(i, "quantity", e.target.value)}
                  />
                  <Input
                    className="col-span-3"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Unit price"
                    value={l.unitPrice}
                    onChange={(e) => setLine(i, "unitPrice", e.target.value)}
                  />
                  <button
                    type="button"
                    className="col-span-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                    onClick={() => removeLine(i)}
                    disabled={lines.length === 1}
                    aria-label="Remove charge line"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="text-right text-sm font-semibold pt-1">Total: {money(total, currency)}</div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant={canSend ? "outline" : "default"} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Save as draft
            </Button>
            {canSend && (
              <Button type="button" disabled={busy} className="gap-2" onClick={(e) => submit(e, true)}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to customer
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ── Review a sent quote and decide — approve or reject on the customer's behalf
      after confirming with them (e.g. on a call). A BDO sees this only for their
      OWN queries; the backend enforces the same scope (RULE-QT-03 relaxation). ── */
const DecideQuoteDialog = ({ busy, query, onClose, onApprove, onReject }) => {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("view"); // "view" | "reject"
  const [reason, setReason] = useState("");

  useEffect(() => {
    let alive = true;
    quotationService
      .listQuotations({ queryId: query.id, status: "sent" })
      .then((res) => {
        if (!alive) return;
        // Scope may widen the result to all of the user's queries, so pin to THIS
        // query. At most one live quote per query (INV-07); take the latest version.
        const sent = (res.data ?? [])
          .filter((qt) => qt.queryId === query.id)
          .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null;
        setQuote(sent);
      })
      .catch((err) => toast.error(err?.message || "Couldn't load the quote"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [query.id]);

  const route = routeOf(query);
  const expired = quote?.validityDate && new Date(quote.validityDate) < new Date();

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Review quote · {query.referenceNo}</DialogTitle>
          <DialogDescription>
            {query.customerCompany}{route ? ` · ${route}` : ""} — confirm the customer's decision, then approve or reject on their behalf.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !quote ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No sent quote found for this query.</div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-medium text-primary">{quote.referenceNo}</span>
              <span className="text-sm text-muted-foreground">
                {quote.validityDate ? `Valid until ${new Date(quote.validityDate).toLocaleDateString()}` : "No expiry"}
              </span>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="p-2 font-medium text-muted-foreground">Description</th>
                    <th className="p-2 font-medium text-muted-foreground text-right">Qty</th>
                    <th className="p-2 font-medium text-muted-foreground text-right">Unit</th>
                    <th className="p-2 font-medium text-muted-foreground text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(quote.chargeLines ?? []).map((l) => (
                    <tr key={l.id ?? l.sortOrder} className="border-t">
                      <td className="p-2">{l.description}</td>
                      <td className="p-2 text-right">{Number(l.quantity)}</td>
                      <td className="p-2 text-right">{money(l.unitPrice, quote.currency)}</td>
                      <td className="p-2 text-right">{money(l.amount, quote.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-right text-sm font-semibold">Total: {money(quote.totalAmount, quote.currency)}</div>

            {expired && (
              <p className="text-xs text-red-600">This quote has passed its validity date — Ops must revise it before it can be approved.</p>
            )}

            {mode === "reject" && (
              <div className="space-y-1.5">
                <Label htmlFor="dq-reason">Rejection reason</Label>
                <Input id="dq-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What did the customer want changed?" autoFocus />
              </div>
            )}

            <DialogFooter className="gap-2">
              {mode === "view" ? (
                <>
                  <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Close</Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2 text-destructive"
                    disabled={busy}
                    onClick={() => setMode("reject")}
                  >
                    <X className="w-4 h-4" /> Reject
                  </Button>
                  <Button type="button" className="gap-2" disabled={busy || expired} onClick={() => onApprove(quote)}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve by customer
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setMode("view")} disabled={busy}>Back</Button>
                  <Button
                    type="button"
                    className="bg-destructive text-white hover:bg-destructive/90 gap-2"
                    disabled={busy}
                    onClick={() => {
                      if (reason.trim().length < 3) return toast.error("A reason is required");
                      onReject(quote, reason.trim());
                    }}
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} Confirm reject
                  </Button>
                </>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const CancelQueryDialog = ({ busy, query, onClose, onSubmit }) => {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel Query {query.referenceNo}</DialogTitle>
          <DialogDescription>Cancellation reasons feed the unserved-demand report.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 3) return toast.error("A reason is required"); onSubmit(reason.trim()); }} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="qcancel-reason">Reason</Label>
            <Input id="qcancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button type="submit" disabled={busy} className="bg-destructive text-white hover:bg-destructive/90">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cancel Query"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default QueriesListPage;
