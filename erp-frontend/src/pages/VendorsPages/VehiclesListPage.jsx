import { useEffect, useState } from "react";
import { Truck, Loader2, Plus, Pencil, Ban, Paperclip } from "lucide-react";
import toast from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import DocumentsDialog from "@/components/DocumentsDialog";
import { VEHICLE_KIND_LABELS } from "@/lib/catalog";
import { useAuthStore } from "@/store/authStore";
import { listVehicles, createVehicle, updateVehicle, deactivateVehicle } from "@/services/fleetService";

/**
 * Own-fleet vehicles. One page serving both sidebar entries — trucks and dumpers
 * are the same record with a different `kind`, so this renders whichever the route
 * pins. Registration papers, route permit and insurance hang off the Docs button.
 * Read: fleet.read; manage: fleet.manage.
 */
export default function VehiclesListPage({ kind = "truck" }) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission("fleet.manage");
  const label = VEHICLE_KIND_LABELS[kind] ?? kind;
  const plural = `${label}s`;

  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ plateNo: "", notes: "" });
  const [docsFor, setDocsFor] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listVehicles({ kind });
      setVehicles(res.data || []);
    } catch (err) {
      toast.error(err?.message || `Could not load ${plural.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  };

  // Refetches on the route change between Trucks and Dumpers — same component,
  // different kind, so the list must not carry over.
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [kind]);

  const openCreate = () => { setEditing(null); setForm({ plateNo: "", notes: "" }); setOpen(true); };
  const openEdit = (v) => {
    setEditing(v);
    setForm({ plateNo: v.plateNo ?? "", notes: v.notes ?? "" });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.plateNo.trim()) return toast.error("Registration number is required");
    setBusy(true);
    try {
      const payload = { kind, plateNo: form.plateNo.trim(), notes: form.notes || undefined };
      const res = editing ? await updateVehicle(editing.id, payload) : await createVehicle(payload);
      toast.success(res?.message || "Saved");
      setOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not save vehicle");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v) => {
    setBusy(true);
    try {
      const res = await deactivateVehicle(v.id);
      toast.success(res?.message || `${label} deactivated`);
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not deactivate");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Truck className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">{plural}</h1>
            <p className="text-sm text-muted-foreground">Own-fleet {plural.toLowerCase()} — registration, permit and insurance papers</p>
          </div>
        </div>
        {canManage && <Button className="gap-2" onClick={openCreate}><Plus className="w-4 h-4" /> New {label.toLowerCase()}</Button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : vehicles.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">No {plural.toLowerCase()} yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Ref</th>
                <th className="px-4 py-2.5">Registration</th>
                <th className="px-4 py-2.5">Notes</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {vehicles.map((v) => (
                <tr key={v.id} className={`hover:bg-muted/30 ${!v.isActive ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5 font-mono text-xs">{v.referenceNo}</td>
                  <td className="px-4 py-2.5 font-medium font-mono">{v.plateNo}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">{v.notes || "—"}</td>
                  <td className="px-4 py-2.5"><Badge variant="outline" className="text-[10px]">{v.isActive ? "Active" : "Inactive"}</Badge></td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => setDocsFor(v)}>
                      <Paperclip className="w-3.5 h-3.5" /> Docs
                    </Button>
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => openEdit(v)}><Pencil className="w-3.5 h-3.5" /></Button>
                        {v.isActive && (
                          <Button size="sm" variant="ghost" className="h-8 text-destructive" disabled={busy} onClick={() => remove(v)}><Ban className="w-3.5 h-3.5" /></Button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Body scrolls, footer stays out of it — a dialog-level scroll puts the last
            field under the sticky footer and past the end of the scroll range. */}
        <DialogContent size="md" className="overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`}</DialogTitle>
            <DialogDescription>Registration papers and permits attach from the Docs button once saved.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-1 min-h-0 flex-col gap-3">
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-1 -mx-1 pb-1 scrollbar-thin">
              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="v-plate">Registration number</Label>
                <Input id="v-plate" value={form.plateNo} onChange={(e) => setForm((p) => ({ ...p, plateNo: e.target.value }))} placeholder="e.g. TLE-1234" />
              </div>
              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="v-notes">Notes</Label>
                <Input id="v-notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Capacity, make, anything worth remembering" />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy} className="gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DocumentsDialog
        open={!!docsFor}
        onOpenChange={(val) => !val && setDocsFor(null)}
        ownerType="vehicle"
        ownerId={docsFor?.id}
        title={docsFor ? `Documents — ${docsFor.plateNo}` : "Documents"}
        subtitle="Registration, route permit and insurance for this vehicle. Internal only."
        defaultDocType="vehicle_registration"
      />
    </div>
  );
}
