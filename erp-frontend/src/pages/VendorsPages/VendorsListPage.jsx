import { useEffect, useState, useMemo } from "react";
import { Truck, Loader2, Plus, Pencil, Ban, Paperclip, Search, MessageSquare, Trash2 } from "lucide-react";
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
import { listVendors, createVendor, updateVendor, deactivateVendor, deleteVendor } from "@/services/vendorService";

const EMPTY = {
  name: "", type: "transporter", contactName: "", email: "", phone: "",
  city: "", country: "", taxId: "", paymentTermsDays: "", currency: "",
  strn: "", rexNo: "", vatNo: "", bankName: "", bankBranch: "", iban: "", swiftCode: "", accountTitle: "", website: "", notes: "",
};

export default function VendorsListPage({ lockedType }) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission("vendor.manage");
  const typeLabel = lockedType ? VENDOR_TYPE_LABELS[lockedType] ?? lockedType : null;

  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState(lockedType ?? "all");
  const [searchQuery, setSearchQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // vendor being edited, or null for create
  const [form, setForm] = useState(EMPTY);
  const [docsFor, setDocsFor] = useState(null); // vendor whose documents are open
  
  // Hard delete confirmation state
  const [vendorToDelete, setVendorToDelete] = useState(null);

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

  useEffect(() => { if (lockedType) setTypeFilter(lockedType); }, [lockedType]);

  const filteredVendors = useMemo(() => {
    if (!searchQuery) return vendors;
    const q = searchQuery.toLowerCase();
    return vendors.filter(v => v.name.toLowerCase().includes(q) || v.referenceNo.toLowerCase().includes(q));
  }, [vendors, searchQuery]);

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
      paymentTermsDays: v.paymentTermsDays ?? "", currency: v.currency ?? "", 
      strn: v.strn ?? "", rexNo: v.rexNo ?? "", vatNo: v.vatNo ?? "", 
      bankName: v.bankName ?? "", bankBranch: v.bankBranch ?? "", iban: v.iban ?? "", 
      swiftCode: v.swiftCode ?? "", accountTitle: v.accountTitle ?? "", website: v.website ?? "", notes: v.notes ?? "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    if (!form.email?.trim()) return toast.error("Email is required");
    if (!form.phone?.trim()) return toast.error("Phone number is required");
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
        strn: form.strn || undefined,
        rexNo: form.rexNo || undefined,
        vatNo: form.vatNo || undefined,
        bankName: form.bankName || undefined,
        bankBranch: form.bankBranch || undefined,
        iban: form.iban || undefined,
        swiftCode: form.swiftCode || undefined,
        accountTitle: form.accountTitle || undefined,
        website: form.website || undefined,
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

  const handleDeactivate = async (v) => {
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
  
  const confirmDelete = async () => {
    if (!vendorToDelete) return;
    setBusy(true);
    try {
      const res = await deleteVendor(vendorToDelete.id);
      toast.success(res?.message || "Vendor deleted");
      setVendorToDelete(null);
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not delete vendor");
    } finally {
      setBusy(false);
    }
  };

  const handleGetQuote = (v) => {
    toast.success(`Quote request sent to ${v.name}`);
  };

const getTypeColor = (type) => {
  const colors = {
    transporter: "bg-blue-700/10 text-blue-700 border-blue-200/60",
    shipping_line: "bg-cyan-700/10 text-cyan-700 border-cyan-200/60",
    container_yard: "bg-amber-700/10 text-amber-700 border-amber-200/60",
    customs_agent: "bg-purple-700/10 text-purple-700 border-purple-200/60",
    destination_agent: "bg-indigo-700/10 text-indigo-700 border-indigo-200/60",
    port_terminal: "bg-orange-700/10 text-orange-700 border-orange-200/60",
    rail_operator: "bg-emerald-700/10 text-emerald-700 border-emerald-200/60",
    freight_forwarder: "bg-fuchsia-700/10 text-fuchsia-700 border-fuchsia-200/60",
    ocean_carrier: "bg-teal-700/10 text-teal-700 border-teal-200/60",
    exporter: "bg-pink-700/10 text-pink-700 border-pink-200/60",
    buyer: "bg-rose-700/10 text-rose-700 border-rose-200/60",
    bank: "bg-yellow-700/10 text-yellow-700 border-yellow-200/60",
    driver: "bg-lime-700/10 text-lime-700 border-lime-200/60",
    other: "bg-gray-700/10 text-gray-700 border-gray-200/60",
  };

  return colors[type] || colors.other;
};
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Premium Header */}
      <div className="p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 rounded-xl">
              <Truck className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{typeLabel ? `${typeLabel}s` : "Vendor Directory"}</h1>
              <p className="text-sm text-muted-foreground">
                {typeLabel
                  ? `Manage all ${typeLabel.toLowerCase()}s, their terms, and related documents`
                  : "Central directory of all counterparties involved in shipments"}
              </p>
            </div>
          </div>
          {canManage && (
            <Button size="lg" className="gap-2 shadow-sm" onClick={openCreate}>
              <Plus className="w-5 h-5" /> Add {typeLabel ? typeLabel : "Vendor"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 max-w-7xl mx-auto w-full space-y-6">
        {/* Filters & Search */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          {!lockedType && (
            <div className="flex flex-wrap gap-2 flex-1 w-full">
              <Button 
                variant={typeFilter === "all" ? "default" : "outline"} 
                size="sm" 
                onClick={() => setTypeFilter("all")}
                className="rounded-full"
              >
                All Types
              </Button>
              {VENDOR_TYPE_OPTIONS.map((t) => (
                <Button
                  key={t.value}
                  variant={typeFilter === t.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTypeFilter(t.value)}
                  className="rounded-full whitespace-nowrap"
                >
                  {t.label}
                </Button>
              ))}
            </div>
          )}
          
          <div className="relative w-full md:w-72 flex-shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              type="text" 
              placeholder="Search vendors..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-background shadow-sm"
            />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary/60" />
            <p>Loading vendor directory...</p>
          </div>
        ) : filteredVendors.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-muted-foreground/20 p-16 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mb-4">
              <Truck className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-1">No vendors found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {searchQuery ? "Try adjusting your search query." : "Get started by adding a new vendor to the directory."}
            </p>
            {!searchQuery && canManage && (
              <Button onClick={openCreate} variant="outline" className="mt-6">Add Vendor</Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filteredVendors.map((v) => (
              <div 
                key={v.id} 
                className={`flex flex-col p-5 bg-card border rounded-xl shadow-sm transition-all hover:shadow-md ${!v.isActive ? "opacity-60" : ""}`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <h3 className="font-semibold text-lg leading-none">{v.name}</h3>
                      {!v.isActive && <Badge variant="secondary" className="text-[10px] uppercase">Inactive</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{v.referenceNo}</span>
                      <span>•</span>
                      {!lockedType && (
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold capitalize tracking-wider ${getTypeColor(v.type)}`}>
                          {VENDOR_TYPE_LABELS[v.type] ?? v.type}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-6 text-sm flex-1">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wider mb-0.5">Contact</p>
                    <p className="truncate" title={v.contactName || v.email || v.phone}>
                      {v.contactName || v.email || v.phone || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wider mb-0.5">Location</p>
                    <p className="truncate">
                      {[v.city, v.country].filter(Boolean).join(", ") || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wider mb-0.5">Bank / IBAN</p>
                    <p className="truncate font-mono text-xs mt-0.5" title={v.iban || v.bankName}>
                      {v.iban ? v.iban : v.bankName ? v.bankName : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wider mb-0.5">Terms</p>
                    <p>
                      {v.paymentTermsDays != null ? `${v.paymentTermsDays} Days` : "—"}
                      {v.currency && <Badge variant="outline" className="ml-2 px-1 text-[10px]">{v.currency}</Badge>}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t gap-2">
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs font-medium" onClick={() => setDocsFor(v)}>
                      <Paperclip className="w-3.5 h-3.5" /> Docs
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-medium text-white bg-primary! border-none hover:text-white hover:bg-primary/90" onClick={() => handleGetQuote(v)}>
                      <MessageSquare className="w-3.5 h-3.5" /> Quote
                    </Button>
                  </div>
                  {canManage && (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openEdit(v)} title="Edit">
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      {v.isActive ? (
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:text-amber-600 hover:bg-amber-50" disabled={busy} onClick={() => handleDeactivate(v)} title="Deactivate">
                          <Ban className="w-4 h-4" />
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:text-destructive hover:bg-destructive/10" disabled={busy} onClick={() => setVendorToDelete(v)} title="Delete">
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!vendorToDelete} onOpenChange={(v) => !v && setVendorToDelete(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete Vendor</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete <strong>{vendorToDelete?.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setVendorToDelete(null)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" className="max-h-[90vh] flex flex-col p-0 overflow-hidden bg-background">
          <DialogHeader className="px-6 py-4 border-b bg-muted/30">
            <DialogTitle className="text-xl">{editing ? "Edit Vendor Profile" : "Create New Vendor"}</DialogTitle>
            <DialogDescription>Complete the counterparty details below for the directory.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
              <div className="space-y-8 max-w-4xl mx-auto">
                
                {/* Section: Basic Info */}
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 border-b pb-2">Basic Info</h4>
                  <div className={lockedType ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 sm:grid-cols-2 gap-4"}>
                    <div className="space-y-2">
                      <Label htmlFor="v-name">Vendor Name <span className="text-destructive">*</span></Label>
                      <Input id="v-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Agilent Freight Services" className="bg-background" />
                    </div>
                    {!lockedType && (
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
                          <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
                          <SelectContent>{VENDOR_TYPE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section: Contact & Location */}
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 border-b pb-2">Contact & Location</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <div className="space-y-2">
                      <Label htmlFor="v-contact">Primary Contact</Label>
                      <Input id="v-contact" value={form.contactName} onChange={(e) => setForm((p) => ({ ...p, contactName: e.target.value }))} placeholder="e.g. John Doe" className="bg-background" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="v-email">Email Address <span className="text-destructive">*</span></Label>
                      <Input id="v-email" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="e.g. contact@example.com" className="bg-background" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="v-phone">Phone Number <span className="text-destructive">*</span></Label>
                      <Input id="v-phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="e.g. +92 300 1234567" className="bg-background" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="v-address">Address</Label>
                      <Input id="v-address" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} placeholder="City, Area..." className="bg-background" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="v-country">Country</Label>
                      <Input id="v-country" value={form.country} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))} placeholder="PK" className="bg-background" />
                    </div>
                  </div>
                </div>

                {/* Section: Registration & Financial */}
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 border-b pb-2">Registration & Terms</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    <div className="space-y-2">
                      <Label htmlFor="v-tax">Tax ID (NTN)</Label>
                      <Input id="v-tax" value={form.taxId} onChange={(e) => setForm((p) => ({ ...p, taxId: e.target.value }))} placeholder="e.g. 1234567-8" className="bg-background font-mono text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="v-strn">STRN</Label>
                      <Input id="v-strn" value={form.strn} onChange={(e) => setForm((p) => ({ ...p, strn: e.target.value }))} placeholder="e.g. 12-00-9805" className="bg-background font-mono text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="v-rex">REX No.</Label>
                      <Input id="v-rex" value={form.rexNo} onChange={(e) => setForm((p) => ({ ...p, rexNo: e.target.value }))} placeholder="e.g. PKREX..." className="bg-background font-mono text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="v-vat">VAT / TVA No.</Label>
                      <Input id="v-vat" value={form.vatNo} onChange={(e) => setForm((p) => ({ ...p, vatNo: e.target.value }))} placeholder="e.g. FR029..." className="bg-background font-mono text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="v-terms">Payment Terms (Days)</Label>
                      <Input id="v-terms" type="number" min="0" value={form.paymentTermsDays} onChange={(e) => setForm((p) => ({ ...p, paymentTermsDays: e.target.value }))} placeholder="e.g. 30" className="bg-background" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="v-ccy">Default Currency</Label>
                      <Input id="v-ccy" maxLength={3} value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))} placeholder={DEFAULT_CURRENCY} className="bg-background uppercase" />
                    </div>
                  </div>
                </div>

                {/* Section: Banking */}
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 border-b pb-2">Banking Details</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div className="space-y-2">
                      <Label htmlFor="v-bank-name">Bank Name</Label>
                      <Input id="v-bank-name" value={form.bankName} onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))} placeholder="e.g. Meezan Bank" className="bg-background" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="v-bank-branch">Branch</Label>
                      <Input id="v-bank-branch" value={form.bankBranch} onChange={(e) => setForm((p) => ({ ...p, bankBranch: e.target.value }))} placeholder="e.g. Jail Road" className="bg-background" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="v-account-title">Account Title</Label>
                      <Input id="v-account-title" value={form.accountTitle} onChange={(e) => setForm((p) => ({ ...p, accountTitle: e.target.value }))} placeholder="e.g. Agilent Freight" className="bg-background" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="v-iban">IBAN / Account No.</Label>
                      <Input id="v-iban" value={form.iban} onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value }))} placeholder="e.g. PK11MEZN..." className="bg-background font-mono text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="v-swift">SWIFT Code</Label>
                      <Input id="v-swift" value={form.swiftCode} onChange={(e) => setForm((p) => ({ ...p, swiftCode: e.target.value }))} placeholder="e.g. MEZNPKKA" className="bg-background font-mono text-sm uppercase" />
                    </div>
                  </div>
                </div>

                {/* Section: Other */}
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 border-b pb-2">Additional</h4>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="v-website">Website</Label>
                      <Input id="v-website" type="url" value={form.website} onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))} placeholder="https://" className="bg-background" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="v-notes">Internal Notes</Label>
                      <Input id="v-notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Any additional details..." className="bg-background" />
                    </div>
                  </div>
                </div>

              </div>
            </div>

            <DialogFooter className="px-6 py-4 border-t bg-muted/30">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy} className="gap-2 px-6">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {editing ? "Save Changes" : "Create Vendor"}
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
