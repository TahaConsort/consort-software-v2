import { useEffect, useMemo, useState } from "react";
import { Loader2, Coins, Search } from "lucide-react";
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
import toast from "react-hot-toast";
import * as vendorService from "@/services/vendorService";
import {
  labelForService, VENDOR_TYPE_LABELS, RFQ_SERVICES, RFQ_LEGS, RFQ_LEG_LABELS,
  vendorTypesFor, routeOf,
} from "@/lib/catalog";

/**
 * Request Rates — turn a query into one rate request per service, each aimed at the
 * vendors who can actually price it.
 *
 * The vendor list is filtered by type per service (a transporter prices inland, a
 * line prices ocean), because scrolling one flat vendor list per service is how ops
 * ends up asking the wrong three people. "Show all" is always one click away — the
 * filter is a shortcut, not a cage.
 */
const RequestRatesDialog = ({ busy, query, onClose, onSubmit }) => {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [showAll, setShowAll] = useState({});
  const [search, setSearch] = useState("");
  // { [groupKey]: Set(vendorId) } — groupKey is "service" or "service:leg"
  const [picked, setPicked] = useState({});

  // lc_finance is a bank instrument — there is no vendor to ask for a rate. A rail
  // query's transport service expands into its three legs, each priced separately.
  const groups = useMemo(
    () =>
      (query.services ?? [])
        .filter((s) => RFQ_SERVICES.includes(s))
        .flatMap((s) =>
          s === "local_transport" && query.inlandMode === "rail"
            ? RFQ_LEGS.map((leg) => ({ service: s, leg, key: `${s}:${leg}` }))
            : [{ service: s, leg: null, key: s }],
        ),
    [query.services, query.inlandMode],
  );

  // What each rail leg actually covers, so ops sees the stretch they're pricing.
  const legRoute = (leg) => {
    const pickup = query.pickupAddress || query.senderAddress;
    const delivery = query.deliveryAddress || query.receiverAddress;
    switch (leg) {
      case "first_mile":
        return [pickup, query.originRailTerminal].filter(Boolean).join(" → ");
      case "middle_mile":
        return [query.originRailTerminal, query.destinationRailTerminal].filter(Boolean).join(" → ");
      case "last_mile":
        return [query.destinationRailTerminal, delivery].filter(Boolean).join(" → ");
      default:
        return "";
    }
  };

  useEffect(() => {
    let alive = true;
    vendorService
      .listVendors({ isActive: true })
      .then((res) => alive && setVendors(res.data ?? []))
      .catch((err) => alive && toast.error(err?.message || "Couldn't load vendors"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const vendorsFor = (group) => {
    const types = vendorTypesFor(group.service, group.leg);
    const base = showAll[group.key] ? vendors : vendors.filter((v) => types.includes(v.type));
    const term = search.trim().toLowerCase();
    return term ? base.filter((v) => v.name.toLowerCase().includes(term)) : base;
  };

  const toggle = (key, vendorId) =>
    setPicked((p) => {
      const next = new Set(p[key] ?? []);
      if (next.has(vendorId)) next.delete(vendorId);
      else next.add(vendorId);
      return { ...p, [key]: next };
    });

  const totalPicked = Object.values(picked).reduce((s, set) => s + set.size, 0);

  const submit = (e) => {
    e.preventDefault();
    const requests = groups
      .filter((g) => (picked[g.key]?.size ?? 0) > 0)
      .map((g) => ({ service: g.service, leg: g.leg ?? undefined, vendorIds: [...picked[g.key]] }));
    if (!requests.length) return toast.error("Pick at least one vendor to ask");
    onSubmit({
      queryId: query.id,
      neededBy: neededBy || undefined,
      notes: notes.trim() || undefined,
      requests,
    });
  };

  const route = routeOf(query);

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent size="lg" className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>Request rates for {query.referenceNo}</DialogTitle>
          <DialogDescription>
            {query.customerCompany}
            {route ? ` · ${route}` : ""} — pick who to ask for each service. One rate
            request is created per service{query.inlandMode === "rail" ? ", and one per rail leg" : ""}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-1 min-h-0 flex-col gap-4">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-1 -mx-1 pb-1 scrollbar-thin">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="rr-needed">Rates needed by (optional)</Label>
                <Input
                  id="rr-needed"
                  type="date"
                  value={neededBy}
                  onChange={(e) => setNeededBy(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="rr-search">Find a vendor</Label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="rr-search"
                    className="pl-8"
                    placeholder="Search by name"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rr-notes">Note to vendors (optional)</Label>
              <Input
                id="rr-notes"
                placeholder="e.g. rate needed inclusive of loading and detention-free days"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {loading ? (
              <div className="py-10 flex justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : groups.length === 0 ? (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                Nothing on this query can be sent to a vendor for a rate. LC / Trade Finance
                is arranged with a bank, not bought from a vendor.
              </div>
            ) : (
              groups.map((group) => {
                const list = vendorsFor(group);
                const types = vendorTypesFor(group.service, group.leg);
                const count = picked[group.key]?.size ?? 0;
                const route = group.leg ? legRoute(group.leg) : "";
                return (
                  <div key={group.key} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{labelForService(group.service)}</span>
                        {group.leg && (
                          <Badge variant="outline" className="text-[10px]">{RFQ_LEG_LABELS[group.leg]}</Badge>
                        )}
                        {count > 0 && <Badge className="text-[10px]">{count} selected</Badge>}
                      </div>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-primary"
                        onClick={() => setShowAll((p) => ({ ...p, [group.key]: !p[group.key] }))}
                      >
                        {showAll[group.key]
                          ? `Show only ${types.map((t) => VENDOR_TYPE_LABELS[t]).join(" / ")}`
                          : "Show all vendors"}
                      </button>
                    </div>
                    {route && <p className="text-xs text-muted-foreground">{route}</p>}

                    {list.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">
                        No active{" "}
                        {showAll[group.key] ? "vendors" : types.map((t) => VENDOR_TYPE_LABELS[t]).join(" / ")}
                        {search ? " match that search" : " on file"}. Add one under Vendors first.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 max-h-48 overflow-y-auto scrollbar-thin">
                        {list.map((v) => (
                          <label
                            key={v.id}
                            className="flex items-center gap-2 py-1 text-sm cursor-pointer hover:text-primary"
                          >
                            <Checkbox
                              checked={picked[group.key]?.has(v.id) ?? false}
                              onCheckedChange={() => toggle(group.key, v.id)}
                            />
                            <span className="truncate">{v.name}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {VENDOR_TYPE_LABELS[v.type]}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || totalPicked === 0} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
              Create {totalPicked > 0 ? `${totalPicked} ` : ""}rate request{totalPicked === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RequestRatesDialog;
