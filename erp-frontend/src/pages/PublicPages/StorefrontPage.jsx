import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Ship, Truck, Plane, Train, Calculator, Package, ArrowRight, Loader2,
  MapPin, CalendarClock, Clock, LogIn, Anchor, CheckCircle2, UserPlus, Send, User, Mail, Phone,
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
import { SERVICE_OPTIONS, labelForService, DEFAULT_CURRENCY } from "@/lib/catalog";
import { getStorefrontReference, getLoadBoard, getRateQuote } from "@/services/storefrontService";
import { createQuery } from "@/services/queryService";
import { saveQuoteDraft } from "@/lib/quoteDraft";
import { useAuthStore } from "@/store/authStore";

const MODE_ICON = { sea: Ship, road: Truck, air: Plane, rail: Train };
const ANY = "any";

const money = (n, ccy = DEFAULT_CURRENCY) =>
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
    // A query records two free-text doors; the ports above still drive the rate calculator.
    pickupAddress: "",
    destinationAddress: "",
    // Who is asking. Nothing is persisted anonymously — these ride along in the parked
    // draft and prefill the signup form so the visitor never types them twice.
    contactName: "",
    contactEmail: "",
    contactPhone: "",
  });
  const [estimate, setEstimate] = useState(null);
  const [calcBusy, setCalcBusy] = useState(false);

  // Load board
  const [postings, setPostings] = useState([]);
  const [boardBusy, setBoardBusy] = useState(true);
  const [boardFilters, setBoardFilters] = useState({ mode: ANY, service: ANY });

  // Quote request (signup-gated — §5.20)
  const [requestBusy, setRequestBusy] = useState(false);
  const queryFormRef = useRef(null);
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

  const scrollToQueryForm = () => {
    queryFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
   * "Send my query" is auth-gated (§5.20): a Query belongs to a customer record, so
   * there has to be an account behind it. A signed-in customer's request goes straight
   * into the pipeline; everyone else is sent to sign in OR sign up with their selection
   * parked, and it is submitted for them the moment their portal exists.
   *
   * `via` picks the door for a visitor who is not signed in — "register" for a first-time
   * caller, "login" for someone who already has an account. Both pages read the same
   * parked draft, so the query lands either way.
   */
  const requestQuote = async (posting, via = "register") => {
    // A posting's lane/services override whatever the calculator holds.
    // A query carries the two doors and the services. The posting's lane stands in for
    // an address the visitor did not type, so a load-board request still has both ends.
    const selection = posting
      ? {
          services: posting.services?.length ? posting.services : form.services,
          pickupAddress: form.pickupAddress || posting.originPort || clean(form.originPort) || "",
          destinationAddress:
            form.destinationAddress || posting.destinationPort || clean(form.destinationPort) || "",
        }
      : {
          services: form.services,
          pickupAddress: form.pickupAddress || clean(form.originPort) || "",
          destinationAddress: form.destinationAddress || clean(form.destinationPort) || "",
        };

    if (!selection.services.length) {
      return toast.error("Select at least one service first");
    }
    if (!selection.pickupAddress || !selection.destinationAddress) {
      return toast.error("Tell us where it moves from and to");
    }

    // Not signed in → park the selection and gate on auth.
    if (!isAuthenticated || user?.role !== "customer") {
      // The contact block is parked too, so the signup form opens already filled in.
      saveQuoteDraft({
        ...selection,
        contactName: form.contactName || undefined,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
      });
      if (isAuthenticated) {
        // An internal user is browsing the storefront — send them to the CRM.
        toast("Staff accounts raise queries inside the CRM", { icon: "ℹ️" });
        return navigate("/admin/queries");
      }
      toast(
        via === "login"
          ? "Sign in and we'll send your query straight through"
          : "Create your account and your query goes out with it",
        { icon: "🔒" },
      );
      return navigate(via === "login" ? "/login" : "/register");
    }

    // Signed-in customer → straight into the pipeline.
    setRequestBusy(true);
    try {
      const r = await createQuery({ customerId: user.customerId, ...selection });
      toast.success(`Query ${r?.data?.referenceNo ?? ""} sent — our team will come back to you shortly`.trim());
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
            Browse available capacity, price the services you actually need, then send us a query — we come back with a firm quote.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={scrollToQueryForm} className="gap-2">
              <Send className="w-4 h-4" /> Send us a query
            </Button>
            {!isAuthenticated && (
              <Button render={<Link to="/login" />} variant="outline" className="gap-2 bg-transparent text-white border-white/30 hover:bg-white/10">
                <LogIn className="w-4 h-4" /> I already have an account
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* ── Send us a query ──
          The direct channel's real front door (§5.20). A Query belongs to a customer
          record, so submitting is auth-gated: a signed-in customer goes straight into
          the pipeline, a visitor picks sign-in or sign-up and their input is parked and
          submitted for them on the other side. Either way a BDO sees it in Queries. */}
      <section ref={queryFormRef} className="border-b bg-muted/30 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="rounded-2xl border bg-card shadow-sm p-6">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="font-semibold text-lg flex items-center gap-2">
                  <Send className="w-5 h-5 text-primary" /> Send us a query
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Tell us what moves and where. A business development officer picks it up and comes back with a firm quote.
                </p>
              </div>
              {isAuthenticated && user?.role === "customer" && (
                <Badge variant="secondary" className="gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Signed in — goes straight to our team
                </Badge>
              )}
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* What they need */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Which services do you need?</Label>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {SERVICE_OPTIONS.map((s) => (
                      <label key={s.value} className="flex items-center gap-2.5 text-sm cursor-pointer rounded-md px-2 py-1.5 hover:bg-muted">
                        <Checkbox checked={form.services.includes(s.value)} onCheckedChange={() => toggleService(s.value)} />
                        {s.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="q-pickup">Pickup location</Label>
                    <Input id="q-pickup" placeholder="Where we collect"
                      value={form.pickupAddress} onChange={(e) => setForm((p) => ({ ...p, pickupAddress: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="q-destination">Destination</Label>
                    <Input id="q-destination" placeholder="Where we deliver"
                      value={form.destinationAddress} onChange={(e) => setForm((p) => ({ ...p, destinationAddress: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* Who is asking. A signed-in customer already told us, so this whole
                  block is only shown to a visitor — it prefills their signup. */}
              <div className="space-y-4">
                {!isAuthenticated ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="q-name" className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-muted-foreground" /> Your name
                      </Label>
                      <Input id="q-name" placeholder="Who should we ask for?"
                        value={form.contactName} onChange={(e) => setForm((p) => ({ ...p, contactName: e.target.value }))} />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="q-email" className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-muted-foreground" /> Work email
                        </Label>
                        <Input id="q-email" type="email" placeholder="you@company.com"
                          value={form.contactEmail} onChange={(e) => setForm((p) => ({ ...p, contactEmail: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="q-phone" className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground" /> Phone
                        </Label>
                        <Input id="q-phone" placeholder="Direct line"
                          value={form.contactPhone} onChange={(e) => setForm((p) => ({ ...p, contactPhone: e.target.value }))} />
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      We carry these over to the next step so you only type them once.
                    </p>
                  </>
                ) : (
                  <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
                    Signed in as <span className="font-medium text-foreground">{user?.email}</span>. Your query is
                    filed against your account and answered in your portal.
                  </div>
                )}

                <div className="pt-1 space-y-3">
                  <Button onClick={() => requestQuote(null)} disabled={requestBusy} className="w-full gap-2">
                    {requestBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send my query
                  </Button>

                  {/* Both auth doors, right where the gate is — a returning customer
                      should not be pushed through signup to send a second query. */}
                  {!isAuthenticated && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button onClick={() => requestQuote(null, "login")} disabled={requestBusy} variant="outline" className="flex-1 gap-2">
                        <LogIn className="w-4 h-4" /> Sign in &amp; send
                      </Button>
                      <Button onClick={() => requestQuote(null, "register")} disabled={requestBusy} variant="outline" className="flex-1 gap-2">
                        <UserPlus className="w-4 h-4" /> Create account &amp; send
                      </Button>
                    </div>
                  )}

                  {!isAuthenticated && (
                    <p className="text-[11px] text-center text-muted-foreground">
                      A free account is what lets us quote you and track the shipment — it takes a minute.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
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
                </div>
              )}

              {/* The calculator prices; the query form below is what actually reaches a
                  human. The selected services carry over, so this is a scroll, not a retype. */}
              <Button onClick={scrollToQueryForm} variant="outline" className="w-full gap-2">
                <ArrowRight className="w-4 h-4" />
                {estimate ? "Send this as a query" : "Send us a query instead"}
              </Button>
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
