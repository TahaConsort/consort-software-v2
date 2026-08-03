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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VENDOR_TYPE_LABELS, VENDOR_TYPE_OPTIONS, DEFAULT_CURRENCY } from "@/lib/catalog";
import DocumentsDialog from "@/components/DocumentsDialog";
import { useAuthStore } from "@/store/authStore";
import { listVendors, createVendor, updateVendor, deactivateVendor } from "@/services/vendorService";

const EMPTY = {
  name: "", type: "transporter", contactName: "", email: "", phone: "",
  city: "", country: "", taxId: "", paymentTermsDays: "", currency: "", notes: "",
};

/**
 * Vendor master (freight-forwarding OTC upgrade). The counterparties on payable
 * charges/invoices. Read: vendor.read; manage: vendor.manage.
 *
 * `lockedType` pins the page to ONE vendor type — the Shipping Lines and
 * Transporters entries under the Vendors menu are this same screen with the type
 * filter fixed and hidden, rather than three near-identical files.
 */
export default function VendorsListPage({ lockedType }) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission("vendor.manage");
  const typeLabel = lockedType ? VENDOR_TYPE_LABELS[lockedType] ?? lockedType : null;

  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState(lockedType ?? "all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // vendor being edited, or null for create
  const [form, setForm] = useState(EMPTY);
  const [docsFor, setDocsFor] = useState(null); // vendor whose documents are open

  const load = async () => {
    setLoading(true);
    try {
      const res = await listVendors(typeFilter === "all" ? {} : { type: typeFilter });
      setVendors(res.data || []);
    } catch (err) {
      toast.error(err?.message || "Could not load vendors");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [typeFilter]);

  // Shipping Lines → Transporters is a route change on the SAME component, so the
  // filter has to follow the prop; without this the second page would keep showing
  // the first one's rows.
  useEffect(() => { if (lockedType) setTypeFilter(lockedType); }, [lockedType]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, ...(lockedType ? { type: lockedType } : {}) });
    setOpen(true);
  };
  
  const openEdit = (v) => {
    setEditing(v);
    setForm({
      name: v.name ?? "", type: v.type, contactName: v.contactName ?? "", email: v.email ?? "",
      phone: v.phone ?? "", city: v.city ?? "", country: v.country ?? "", taxId: v.taxId ?? "",
      paymentTermsDays: v.paymentTermsDays ?? "", currency: v.currency ?? "", notes: v.notes ?? "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        contactName: form.contactName || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        city: form.city || undefined,
        country: form.country || undefined,
        taxId: form.taxId || undefined,
        paymentTermsDays: form.paymentTermsDays === "" ? undefined : Number(form.paymentTermsDays),
        currency: form.currency ? form.currency.toUpperCase() : undefined,
        notes: form.notes || undefined,
      };
      const res = editing ? await updateVendor(editing.id, payload) : await createVendor(payload);
      toast.success(res?.message || "Saved");
      setOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not save vendor");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v) => {
    setBusy(true);
    try {
      const res = await deactivateVendor(v.id);
      toast.success(res?.message || "Vendor deactivated");
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
            <h1 className="text-xl font-semibold">{typeLabel ? `${typeLabel}s` : "Vendors"}</h1>
            <p className="text-sm text-muted-foreground">
              {typeLabel
                ? `${typeLabel}s billed on payable charges — contacts, terms and their paperwork`
                : "Transporters, shipping lines, yards & agents billed on payable charges"}
            </p>
          </div>
        </div>
        {canManage && (
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="w-4 h-4" /> New {typeLabel ? typeLabel.toLowerCase() : "vendor"}
          </Button>
        )}
      </div>

      {!lockedType && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {VENDOR_TYPE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : vendors.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">No vendors yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Ref</th>
                <th className="px-4 py-2.5">Name</th>
                {!lockedType && <th className="px-4 py-2.5">Type</th>}
                <th className="px-4 py-2.5">Contact</th>
                <th className="px-4 py-2.5">Location</th>
                <th className="px-4 py-2.5">Terms</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {vendors.map((v) => (
                <tr key={v.id} className={`hover:bg-muted/30 ${!v.isActive ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5 font-mono text-xs">{v.referenceNo}</td>
                  <td className="px-4 py-2.5 font-medium">{v.name}</td>
                  {!lockedType && (
                    <td className="px-4 py-2.5"><Badge variant="outline" className="text-[10px]">{VENDOR_TYPE_LABELS[v.type] ?? v.type}</Badge></td>
                  )}
                  <td className="px-4 py-2.5 text-xs">{v.contactName || v.email || v.phone || "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{[v.city, v.country].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{v.paymentTermsDays != null ? `${v.paymentTermsDays}d` : "—"}{v.currency ? ` · ${v.currency}` : ""}</td>
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
        {/* overflow-hidden moves the scrollbar off the dialog and onto the field area
            below. Left on the dialog, the sticky footer covers the final row as it
            scrolls under it, and the footer's -mb-5 puts the last pixels out of
            scroll reach entirely — the "last field is cut off" everyone hits. */}
        <DialogContent size="lg" className="overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit vendor" : "New vendor"}</DialogTitle>
            <DialogDescription>Vendors are billed on payable charges and invoices.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-1 min-h-0 flex-col gap-3">
            {/* px-1 -mx-1 pb-1 buys room for the focus ring, which a scroll container
                would otherwise shear off the outermost fields. */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-1 -mx-1 pb-1 scrollbar-thin">
              <div className={lockedType ? "" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="v-name">Name</Label>
                  <Input id="v-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. National Highway Transporters" />
                </div>
                {!lockedType && (
                  <div className="space-y-1.5 min-w-0">
                    <Label>Type</Label>
                    {/* w-full, because SelectTrigger is `w-fit whitespace-nowrap` by default:
                        left alone it sizes to "Destination Agent" and, being un-shrinkable,
                        drags the whole grid wider than the dialog. */}
                    <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{VENDOR_TYPE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="v-contact">Contact</Label>
                  <Input id="v-contact" value={form.contactName} onChange={(e) => setForm((p) => ({ ...p, contactName: e.target.value }))} />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="v-email">Email</Label>
                  <Input id="v-email" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="v-phone">Phone</Label>
                  <Input id="v-phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>

              {/* Four short fields: two per row on a phone, four across from `sm` up —
                  at four columns on a narrow dialog the labels wrap to three lines each. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="v-city">City</Label>
                  <Input id="v-city" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="v-country">Country</Label>
                  <Input id="v-country" value={form.country} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))} placeholder="PK" />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="v-terms">Terms (days)</Label>
                  <Input id="v-terms" type="number" min="0" value={form.paymentTermsDays} onChange={(e) => setForm((p) => ({ ...p, paymentTermsDays: e.target.value }))} />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="v-ccy">Currency</Label>
                  <Input id="v-ccy" maxLength={3} value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))} placeholder={DEFAULT_CURRENCY} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="v-tax">Tax ID (NTN/STRN)</Label>
                  <Input id="v-tax" value={form.taxId} onChange={(e) => setForm((p) => ({ ...p, taxId: e.target.value }))} />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="v-notes">Notes</Label>
                  <Input id="v-notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
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
        ownerType="vendor"
        ownerId={docsFor?.id}
        title={docsFor ? `Documents — ${docsFor.name}` : "Documents"}
        subtitle="Tax certificates, agreements and any other paperwork for this vendor. Internal only."
        defaultDocType="tax_certificate"
      />
    </div>
  );
}
