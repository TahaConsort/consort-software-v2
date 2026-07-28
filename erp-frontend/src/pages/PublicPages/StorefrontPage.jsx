import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Ship, Truck, Plane, Train, Calculator, Package, ArrowRight, Loader2,
  MapPin, CalendarClock, Clock, LogIn, Anchor, CheckCircle2, UserPlus,
} from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SERVICE_OPTIONS, labelForService } from "@/lib/catalog";
import { getStorefrontReference, getLoadBoard, getRateQuote } from "@/services/storefrontService";
import { createQuery } from "@/services/queryService";
import { saveQuoteDraft } from "@/lib/quoteDraft";
import { useAuthStore } from "@/store/authStore";

const MODE_ICON = { sea: Ship, road: Truck, air: Plane, rail: Train };
const ANY = "any";

const money = (n, ccy = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(Number(n || 0));

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

/**
 * Public storefront (CRM_MASTER §5.20) — the anonymous front door and concrete
 * intake for the *direct* channel. Browse the load board, price a shipment, and
 * submit a request that lands in the Sales triage inbox.
 */
export default function StorefrontPage() {
  const [reference, setReference] = useState({ ports: [], containerTypes: [] });

  // Rate calculator form
  const [form, setForm] = useState({
    services: [],
    originPort: ANY,
    destinationPort: ANY,
    containerTypeCode: ANY,
    weightKg: "",
  });
  const [estimate, setEstimate] = useState(null);
  const [calcBusy, setCalcBusy] = useState(false);

  // Load board
  const [postings, setPostings] = useState([]);
  const [boardBusy, setBoardBusy] = useState(true);
  const [boardFilters, setBoardFilters] = useState({ mode: ANY, service: ANY });

  // Quote request (signup-gated — §5.20)
  const [requestBusy, setRequestBusy] = useState(false);
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    getStorefrontReference()
      .then((r) => setReference(r.data))
      .catch(() => {});
  }, []);

  const loadBoard = useMemo(
    () => async () => {
      setBoardBusy(true);
      try {
        const r = await getLoadBoard({
          mode: boardFilters.mode !== ANY ? boardFilters.mode : undefined,
          service: boardFilters.service !== ANY ? boardFilters.service : undefined,
        });
        setPostings(r.data || []);
      } catch {
        setPostings([]);
      } finally {
        setBoardBusy(false);
      }
    },
    [boardFilters],
  );

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const toggleService = (code) =>
    setForm((p) => ({
      ...p,
      services: p.services.includes(code) ? p.services.filter((s) => s !== code) : [...p.services, code],
    }));

  const clean = (v) => (v && v !== ANY ? v : undefined);

  const calculate = async () => {
    if (!form.services.length) return toast.error("Select at least one service");
    setCalcBusy(true);
    try {
      const r = await getRateQuote({
        services: form.services,
        originPort: clean(form.originPort),
        destinationPort: clean(form.destinationPort),
        containerTypeCode: clean(form.containerTypeCode),
        weightKg: form.weightKg ? Number(form.weightKg) : undefined,
      });
      setEstimate(r.data);
    } catch (err) {
      toast.error(err?.message || "Could not calculate a rate");
    } finally {
      setCalcBusy(false);
    }
  };

  /**
   * "Get a quote" is signup-gated (§5.20): a formal quotation needs a real
   * customer account. A signed-in customer's request goes straight into the
   * pipeline as a Query; everyone else is sent to sign up with their selection
   * parked, and it is submitted for them the moment their portal exists.
   */
  const requestQuote = async (posting) => {
    // A posting's lane/services override whatever the calculator holds.
    const selection = posting
      ? {
          services: posting.services?.length ? posting.services : form.services,
          originPort: posting.originPort || clean(form.originPort),
          destinationPort: posting.destinationPort || clean(form.destinationPort),
          containerTypeCode: posting.containerTypeCode || clean(form.containerTypeCode),
          weightKg: form.weightKg ? Number(form.weightKg) : undefined,
        }
      : {
          services: form.services,
          originPort: clean(form.originPort),
          destinationPort: clean(form.destinationPort),
          containerTypeCode: clean(form.containerTypeCode),
          weightKg: form.weightKg ? Number(form.weightKg) : undefined,
        };

    if (!selection.services.length) {
      return toast.error("Select at least one service first");
    }

    // Not signed in → park the selection and gate on signup.
    if (!isAuthenticated || user?.role !== "customer") {
      saveQuoteDraft(selection);
      if (isAuthenticated) {
        // An internal user is browsing the storefront — send them to the CRM.
        toast("Staff accounts raise queries inside the CRM", { icon: "ℹ️" });
        return navigate("/admin/queries");
      }
      toast("Create your account to receive a formal quote", { icon: "🔒" });
      return navigate("/register");
    }

    // Signed-in customer → straight into the pipeline.
    setRequestBusy(true);
    try {
      const r = await createQuery({ customerId: user.customerId, ...selection });
      toast.success(`Request ${r?.data?.referenceNo ?? ""} sent — our team will quote it shortly`.trim());
      navigate("/dashboard");
    } catch (err) {
      toast.error(err?.message || "Could not submit your request");
    } finally {
      setRequestBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Consort Group" className="w-10" />
            <div className="leading-tight">
              <p className="font-black uppercase text-sm">
                Consort <span className="text-primary">Group</span>
              </p>
              <p className="text-[11px] text-muted-foreground">Logistics &amp; Supply Chain</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Button render={<Link to={user?.role === "customer" ? "/dashboard" : "/admin"} />} size="sm" className="gap-2">
                <LogIn className="w-4 h-4" /> My portal
              </Button>
            ) : (
              <>
                <Button render={<Link to="/login" />} variant="outline" size="sm" className="gap-2">
                  <LogIn className="w-4 h-4" /> Sign in
                </Button>
                <Button render={<Link to="/register" />} size="sm" className="gap-2">
                  <UserPlus className="w-4 h-4" /> Create account
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b bg-zinc-900 text-white">
        <div className="absolute inset-0 bg-gradient-to-l from-zinc-900 to-[#0043E0]/40" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff10_1px,transparent_1px),linear-gradient(to_bottom,#ffffff10_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="relative max-w-6xl mx-auto px-4 py-16">
          <Badge className="bg-primary/20 text-white border-white/20 mb-4 gap-1.5">
            <Anchor className="w-3.5 h-3.5" /> À-la-carte freight forwarding
          </Badge>
          <h1 className="text-3xl sm:text-5xl font-bold max-w-2xl leading-tight">
            Instant indicative rates for your next shipment.
          </h1>
          <p className="mt-4 text-slate-300 max-w-xl">
            Browse available capacity, price the services you actually need, and request a quote — no account required.
          </p>
        </div>
      </section>

      <main className="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-5 gap-8">
        {/* ── Rate calculator ── */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border bg-card shadow-sm p-5 sticky top-20">
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <Calculator className="w-5 h-5 text-primary" /> Rate Calculator
            </h2>

            <div className="space-y-4">
              {/* Services */}
              <div className="space-y-2">
                <Label>Services</Label>
                <div className="grid grid-cols-1 gap-1.5">
                  {SERVICE_OPTIONS.map((s) => (
                    <label key={s.value} className="flex items-center gap-2.5 text-sm cursor-pointer rounded-md px-2 py-1.5 hover:bg-muted">
                      <Checkbox checked={form.services.includes(s.value)} onCheckedChange={() => toggleService(s.value)} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Lane */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Origin</Label>
                  <Select
                    value={form.originPort}
                    onValueChange={(v) => setForm((p) => ({ ...p, originPort: v }))}
                    items={[{ value: ANY, label: "Any" }, ...reference.ports.map((p) => ({ value: p.code, label: `${p.code} — ${p.name}` }))]}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Any</SelectItem>
                      {reference.ports.map((p) => (
                        <SelectItem key={p.code} value={p.code}>{p.code} — {p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Destination</Label>
                  <Select
                    value={form.destinationPort}
                    onValueChange={(v) => setForm((p) => ({ ...p, destinationPort: v }))}
                    items={[{ value: ANY, label: "Any" }, ...reference.ports.map((p) => ({ value: p.code, label: `${p.code} — ${p.name}` }))]}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Any</SelectItem>
                      {reference.ports.map((p) => (
                        <SelectItem key={p.code} value={p.code}>{p.code} — {p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Container + weight */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Container</Label>
                  <Select
                    value={form.containerTypeCode}
                    onValueChange={(v) => setForm((p) => ({ ...p, containerTypeCode: v }))}
                    items={[{ value: ANY, label: "Any" }, ...reference.containerTypes.map((c) => ({ value: c.code, label: c.label }))]}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Any</SelectItem>
                      {reference.containerTypes.map((c) => (
                        <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="weight">Weight (kg)</Label>
                  <Input id="weight" type="number" min="0" placeholder="optional"
                    value={form.weightKg} onChange={(e) => setForm((p) => ({ ...p, weightKg: e.target.value }))} />
                </div>
              </div>

              <Button onClick={calculate} disabled={calcBusy} className="w-full gap-2">
                {calcBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                Calculate indicative rate
              </Button>

              {/* Estimate */}
              {estimate && (
                <div className="rounded-xl border bg-muted/40 p-4 space-y-2">
                  {estimate.lane && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" /> {estimate.lane}
                    </p>
                  )}
                  <ul className="space-y-1 text-sm">
                    {estimate.lines.map((l) => (
                      <li key={l.service} className="flex justify-between">
                        <span className="text-muted-foreground">{l.label}</span>
                        <span className="font-medium">{money(l.amount, estimate.currency)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Estimated total</span>
                    <span className="text-primary">{money(estimate.total, estimate.currency)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{estimate.disclaimer}</p>
                  <Button onClick={() => requestQuote(null)} disabled={requestBusy} className="w-full gap-2 mt-1">
                    {requestBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                    Request a formal quote
                  </Button>
                </div>
              )}

              {!estimate && (
                <Button onClick={() => requestQuote(null)} disabled={requestBusy} variant="outline" className="w-full gap-2">
                  {requestBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  Request a quote
                </Button>
              )}

              {!isAuthenticated && (
                <p className="text-[11px] text-center text-muted-foreground">
                  A free account is needed to receive a formal quote.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Load board ── */}
        <div className="lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" /> Load Board
              <span className="text-sm text-muted-foreground font-normal">available capacity</span>
            </h2>
            <div className="flex gap-2">
              <Select
                value={boardFilters.mode}
                onValueChange={(v) => setBoardFilters((p) => ({ ...p, mode: v }))}
                items={[
                  { value: ANY, label: "All modes" },
                  { value: "sea", label: "Sea" },
                  { value: "road", label: "Road" },
                  { value: "air", label: "Air" },
                  { value: "rail", label: "Rail" },
                ]}
              >
                <SelectTrigger className="h-9 w-28"><SelectValue placeholder="Mode" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All modes</SelectItem>
                  <SelectItem value="sea">Sea</SelectItem>
                  <SelectItem value="road">Road</SelectItem>
                  <SelectItem value="air">Air</SelectItem>
                  <SelectItem value="rail">Rail</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={boardFilters.service}
                onValueChange={(v) => setBoardFilters((p) => ({ ...p, service: v }))}
                items={[{ value: ANY, label: "All services" }, ...SERVICE_OPTIONS.map((s) => ({ value: s.value, label: s.label }))]}
              >
                <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Service" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All services</SelectItem>
                  {SERVICE_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {boardBusy ? (
            <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : postings.length === 0 ? (
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              No postings match your filters right now — request a quote and we'll source it.
            </div>
          ) : (
            <div className="space-y-3">
              {postings.map((p) => {
                const Icon = MODE_ICON[p.mode] ?? Ship;
                return (
                  <div key={p.id} className="rounded-xl border bg-card p-4 shadow-sm hover:border-primary/40 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-semibold">
                          <Icon className="w-4 h-4 text-primary shrink-0" />
                          <span>{p.originPort}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>{p.destinationPort}</span>
                          <Badge variant="secondary" className="ml-1 capitalize text-[10px]">{p.mode}</Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                          {p.equipment && <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" /> {p.equipment}</span>}
                          {p.departureDate && <span className="flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> Departs {fmtDate(p.departureDate)}</span>}
                          {p.transitDays != null && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {p.transitDays}d transit</span>}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(p.services || []).map((s) => (
                            <Badge key={s} variant="outline" className="text-[10px]">{labelForService(s)}</Badge>
                          ))}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {p.indicativeRate != null && (
                          <>
                            <p className="text-lg font-bold text-primary">{money(p.indicativeRate, p.currency)}</p>
                            <p className="text-[10px] text-muted-foreground">indicative</p>
                          </>
                        )}
                        <Button size="sm" className="mt-2 gap-1" disabled={requestBusy} onClick={() => requestQuote(p)}>
                          Get a quote
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t mt-8">
        <div className="max-w-6xl mx-auto px-4 py-8 text-sm text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <span>© 2026 Consort Group — Transportation, Logistics &amp; Supply Chain Management</span>
          <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-primary" /> Rates are indicative and non-binding</span>
        </div>
      </footer>

    </div>
  );
}
