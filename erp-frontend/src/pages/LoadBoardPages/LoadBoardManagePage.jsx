import { useEffect, useState } from "react";
import { Package, Loader2, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SERVICE_OPTIONS, labelForService, DEFAULT_CURRENCY } from "@/lib/catalog";
import { getStorefrontReference } from "@/services/storefrontService";
import { listPostings, createPosting, deletePosting } from "@/services/loadboardService";

const MODES = ["sea", "road", "air", "rail"];
const money = (n, ccy = DEFAULT_CURRENCY) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(Number(n));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");

const EMPTY = {
  mode: "sea", originPort: "", destinationPort: "", containerTypeCode: "", equipment: "",
  capacity: "", departureDate: "", validUntil: "", transitDays: "", indicativeRate: "", services: [], notes: "",
};

/**
 * Internal load board management (CRM_MASTER §5.20). Operations/Transport curate
 * the postings shown on the public storefront.
 */
export default function LoadBoardManagePage() {
  const [postings, setPostings] = useState([]);
  const [reference, setReference] = useState({ ports: [], containerTypes: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listPostings();
      setPostings(res.data || []);
    } catch (err) {
      toast.error(err?.message || "Could not load postings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getStorefrontReference().then((r) => setReference(r.data)).catch(() => {});
  }, []);

  const toggleService = (code) =>
    setForm((p) => ({
      ...p,
      services: p.services.includes(code) ? p.services.filter((s) => s !== code) : [...p.services, code],
    }));

  const num = (v) => (v === "" || v == null ? undefined : Number(v));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.originPort || !form.destinationPort) return toast.error("Origin and destination are required");
    setBusy(true);
    try {
      const res = await createPosting({
        mode: form.mode,
        originPort: form.originPort,
        destinationPort: form.destinationPort,
        containerTypeCode: form.containerTypeCode || undefined,
        equipment: form.equipment || undefined,
        capacity: num(form.capacity),
        departureDate: form.departureDate || undefined,
        validUntil: form.validUntil || undefined,
        transitDays: num(form.transitDays),
        indicativeRate: num(form.indicativeRate),
        services: form.services,
        notes: form.notes || undefined,
      });
      toast.success(res?.message || "Posting created");
      setOpen(false);
      setForm(EMPTY);
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not create posting");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      const res = await deletePosting(id);
      toast.success(res?.message || "Removed");
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not remove");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Package className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Load Board</h1>
            <p className="text-sm text-muted-foreground">Capacity postings shown on the public storefront (§5.20)</p>
          </div>
        </div>
        <Button className="gap-2" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> New posting</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : postings.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">No postings yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Ref</th>
                <th className="px-4 py-2.5">Lane</th>
                <th className="px-4 py-2.5">Mode</th>
                <th className="px-4 py-2.5">Equipment</th>
                <th className="px-4 py-2.5">Departs</th>
                <th className="px-4 py-2.5">Rate</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {postings.map((p) => (
                <tr key={p.id} className={`hover:bg-muted/30 ${!p.isActive ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5 font-mono text-xs">{p.referenceNo}</td>
                  <td className="px-4 py-2.5">{p.originPort} → {p.destinationPort}</td>
                  <td className="px-4 py-2.5 capitalize">{p.mode}</td>
                  <td className="px-4 py-2.5 text-xs">{p.equipment || "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{fmtDate(p.departureDate)}</td>
                  <td className="px-4 py-2.5 text-xs">{money(p.indicativeRate, p.currency)}</td>
                  <td className="px-4 py-2.5"><Badge variant="outline" className="capitalize text-[10px]">{p.isActive ? p.status : "removed"}</Badge></td>
                  <td className="px-4 py-2.5 text-right">
                    {p.isActive && (
                      <Button size="sm" variant="ghost" className="h-8 text-destructive" disabled={busy} onClick={() => remove(p.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>New load board posting</DialogTitle>
            <DialogDescription>This appears on the public storefront while active and open.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select
                  value={form.mode}
                  onValueChange={(v) => setForm((p) => ({ ...p, mode: v }))}
                  items={MODES.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MODES.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Origin</Label>
                <Select value={form.originPort} onValueChange={(v) => setForm((p) => ({ ...p, originPort: v }))}>
                  <SelectTrigger><SelectValue placeholder="Port" /></SelectTrigger>
                  <SelectContent>{reference.ports.map((p) => <SelectItem key={p.code} value={p.code}>{p.code}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Destination</Label>
                <Select value={form.destinationPort} onValueChange={(v) => setForm((p) => ({ ...p, destinationPort: v }))}>
                  <SelectTrigger><SelectValue placeholder="Port" /></SelectTrigger>
                  <SelectContent>{reference.ports.map((p) => <SelectItem key={p.code} value={p.code}>{p.code}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Container</Label>
                <Select
                  value={form.containerTypeCode || "none"}
                  onValueChange={(v) => setForm((p) => ({ ...p, containerTypeCode: v === "none" ? "" : v }))}
                  items={[{ value: "none", label: "None" }, ...reference.containerTypes.map((c) => ({ value: c.code, label: c.label }))]}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {reference.containerTypes.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lb-equip">Equipment</Label>
                <Input id="lb-equip" value={form.equipment} onChange={(e) => setForm((p) => ({ ...p, equipment: e.target.value }))} placeholder="40HC x3" />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lb-cap">Capacity</Label>
                <Input id="lb-cap" type="number" min="0" value={form.capacity} onChange={(e) => setForm((p) => ({ ...p, capacity: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lb-transit">Transit (d)</Label>
                <Input id="lb-transit" type="number" min="0" value={form.transitDays} onChange={(e) => setForm((p) => ({ ...p, transitDays: e.target.value }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="lb-rate">Indicative rate ({DEFAULT_CURRENCY})</Label>
                <Input id="lb-rate" type="number" min="0" value={form.indicativeRate} onChange={(e) => setForm((p) => ({ ...p, indicativeRate: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lb-dep">Departure</Label>
                <Input id="lb-dep" type="date" value={form.departureDate} onChange={(e) => setForm((p) => ({ ...p, departureDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lb-valid">Valid until</Label>
                <Input id="lb-valid" type="date" value={form.validUntil} onChange={(e) => setForm((p) => ({ ...p, validUntil: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Services offered</Label>
              <div className="grid grid-cols-2 gap-1">
                {SERVICE_OPTIONS.map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={form.services.includes(s.value)} onCheckedChange={() => toggleService(s.value)} />
                    {labelForService(s.value)}
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy} className="gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
