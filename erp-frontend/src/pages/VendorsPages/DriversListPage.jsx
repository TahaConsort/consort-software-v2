import { useEffect, useState } from "react";
import { IdCard, Loader2, Plus, Pencil, Ban, Paperclip, Coins } from "lucide-react";
import toast from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import DocumentsDialog from "@/components/DocumentsDialog";
import { useAuthStore } from "@/store/authStore";
import { listDrivers, createDriver, updateDriver, deactivateDriver } from "@/services/fleetService";
import { createVendor } from "@/services/vendorService";

const EMPTY = { name: "", phone: "", cnic: "", licenseNo: "" };

// Stored digits-only; shown the way it is printed on the card.
const prettyCnic = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 13 ? `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}` : v || "—";
};

/**
 * Drivers — own-fleet master. Four identifying fields and the paperwork that
 * proves them (CNIC, licence), which is what the Docs button is for.
 * Read: fleet.read; manage: fleet.manage.
 */
export default function DriversListPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission("fleet.manage");
  // Listing an owner-driver as a vendor is a vendor write, not a fleet one.
  const canAddVendor = hasPermission("vendor.manage");

  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [docsFor, setDocsFor] = useState(null); // driver whose documents are open

  const load = async () => {
    setLoading(true);
    try {
      const res = await listDrivers();
      setDrivers(res.data || []);
    } catch (err) {
      toast.error(err?.message || "Could not load drivers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (d) => {
    setEditing(d);
    setForm({
      name: d.name ?? "", phone: d.phone ?? "", cnic: d.cnic ?? "", licenseNo: d.licenseNo ?? "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    setBusy(true);
    try {
      // Sent as-is: the server strips separators and rejects anything that is not
      // 13 digits, so "42101-1234567-1" and "4210112345671" are the same driver.
      const payload = {
        name: form.name.trim(),
        phone: form.phone || undefined,
        cnic: form.cnic || undefined,
        licenseNo: form.licenseNo || undefined,
      };
      const res = editing ? await updateDriver(editing.id, payload) : await createDriver(payload);
      toast.success(res?.message || "Saved");
      setOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not save driver");
    } finally {
      setBusy(false);
    }
  };

  /**
   * List an owner-driver as a transporter so they can be asked for rates.
   *
   * A driver and a vendor are different things here — a salaried driver is never
   * billed — but an owner-driver is both, and re-typing their details into the
   * vendor form to get them onto a rate request is pure friction. The server's
   * duplicate-name detection catches a second click.
   */
  const addAsVendor = async (d) => {
    setBusy(true);
    try {
      const res = await createVendor({
        name: d.name,
        type: "transporter",
        phone: d.phone || undefined,
        notes: `Owner-driver — fleet ref ${d.referenceNo}`,
      });
      toast.success(res?.message || `${d.name} listed as a transporter`);
    } catch (err) {
      toast.error(err?.message || "Could not add as vendor");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d) => {
    setBusy(true);
    try {
      const res = await deactivateDriver(d.id);
      toast.success(res?.message || "Driver deactivated");
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
          <IdCard className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Drivers</h1>
            <p className="text-sm text-muted-foreground">Own-fleet drivers — identity, licence and their scanned paperwork</p>
          </div>
        </div>
        {canManage && <Button className="gap-2" onClick={openCreate}><Plus className="w-4 h-4" /> New driver</Button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : drivers.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">No drivers yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Ref</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Phone</th>
                <th className="px-4 py-2.5">CNIC</th>
                <th className="px-4 py-2.5">Licence</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {drivers.map((d) => (
                <tr key={d.id} className={`hover:bg-muted/30 ${!d.isActive ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5 font-mono text-xs">{d.referenceNo}</td>
                  <td className="px-4 py-2.5 font-medium">{d.name}</td>
                  <td className="px-4 py-2.5 text-xs">{d.phone || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{prettyCnic(d.cnic)}</td>
                  <td className="px-4 py-2.5 text-xs">{d.licenseNo || "—"}</td>
                  <td className="px-4 py-2.5"><Badge variant="outline" className="text-[10px]">{d.isActive ? "Active" : "Inactive"}</Badge></td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => setDocsFor(d)}>
                      <Paperclip className="w-3.5 h-3.5" /> Docs
                    </Button>
                    {canAddVendor && d.isActive && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs gap-1"
                        disabled={busy}
                        title="List this owner-driver as a transporter so they can be asked for rates"
                        onClick={() => addAsVendor(d)}
                      >
                        <Coins className="w-3.5 h-3.5" /> Add as vendor
                      </Button>
                    )}
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => openEdit(d)}><Pencil className="w-3.5 h-3.5" /></Button>
                        {d.isActive && (
                          <Button size="sm" variant="ghost" className="h-8 text-destructive" disabled={busy} onClick={() => remove(d)}><Ban className="w-3.5 h-3.5" /></Button>
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
            <DialogTitle>{editing ? "Edit driver" : "New driver"}</DialogTitle>
            <DialogDescription>Attach the CNIC and licence scans from the Docs button once saved.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-1 min-h-0 flex-col gap-3">
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-1 -mx-1 pb-1 scrollbar-thin">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="d-name">Name</Label>
                  <Input id="d-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Muhammad Aslam" />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="d-phone">Phone</Label>
                  <Input id="d-phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="03xx-xxxxxxx" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="d-cnic">CNIC</Label>
                  <Input id="d-cnic" value={form.cnic} onChange={(e) => setForm((p) => ({ ...p, cnic: e.target.value }))} placeholder="42101-1234567-1" />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="d-license">Licence number</Label>
                  <Input id="d-license" value={form.licenseNo} onChange={(e) => setForm((p) => ({ ...p, licenseNo: e.target.value }))} />
                </div>
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
        onOpenChange={(v) => !v && setDocsFor(null)}
        ownerType="driver"
        ownerId={docsFor?.id}
        title={docsFor ? `Documents — ${docsFor.name}` : "Documents"}
        subtitle="CNIC, licence and any other paperwork for this driver. Internal only."
        defaultDocType="cnic"
      />
    </div>
  );
}
