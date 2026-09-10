import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Plus, Trash2, Loader2, AlertTriangle, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import {
  PARTY_ROLE_OPTIONS,
  PARTY_ROLE_VENDOR_TYPES,
  VENDOR_TYPE_LABELS,
  labelForPartyRole,
} from "@/lib/catalog";
import {
  listShipmentParties,
  addShipmentParty,
  updateShipmentParty,
  removeShipmentParty,
} from "@/services/shipmentService";
import { listVendors } from "@/services/vendorService";

/**
 * Who plays which role on THIS shipment (Export Shipment Workflow roadmap §2/§3/§7).
 *
 * The roadmap's central rule, made visible: a company's contact and banking details are
 * stored once on the party record, and the ROLE is chosen per shipment. The vendor
 * picker is ORDERED by `Vendor.type` but never filtered by it — the same company has to
 * be selectable as Vendor on one job and Freight Forwarder on the next, and Consort
 * itself is Manufacturer on an export and Freight Forwarder on an import.
 *
 * Permissions: `trade.read` to see the list, `trade.party.manage` to change it. A portal
 * customer holds only the former, and the server additionally strips every bank and tax
 * field from what it returns them — so this component renders what it is given and
 * never assumes those fields are present.
 */
const ShipmentPartiesPanel = ({ shipmentId, locked, lockReason }) => {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission("trade.party.manage") && !locked;

  const [parties, setParties] = useState([]);
  const [missingRoles, setMissingRoles] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ role: "", vendorId: "", notes: "" });

  /**
   * `alive` is passed in rather than captured so the mount effect can cancel its own
   * write-back on unmount, while the post-mutation refresh below always applies.
   */
  const load = useCallback(
    async (alive = () => true) => {
      try {
        const res = await listShipmentParties(shipmentId);
        if (!alive()) return;
        setParties(res.data?.parties ?? []);
        setMissingRoles(res.data?.missingRoles ?? []);
      } catch (err) {
        // A 403/404 here is a scope answer, not a crash — leave the panel empty and quiet.
        if (!alive()) return;
        setParties([]);
        setMissingRoles([]);
        if (err?.status && ![403, 404].includes(err.status)) toast.error(err?.message || "Could not load parties");
      } finally {
        if (alive()) setLoading(false);
      }
    },
    [shipmentId],
  );

  useEffect(() => {
    let mounted = true;
    // load() is async: every setState runs in an await continuation and is guarded by
    // the `mounted` flag above, so nothing is set synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(() => mounted);
    return () => {
      mounted = false;
    };
  }, [load]);

  // Only fetched when the user can actually add a party — a portal customer never
  // gets the vendor directory.
  useEffect(() => {
    if (!canManage) return;
    listVendors({ isActive: true })
      .then((r) => setVendors(r.data || []))
      .catch(() => {});
  }, [canManage]);

  /** Suggested types first, everything else after — ordered, never filtered. */
  const orderedVendors = useMemo(() => {
    const preferred = PARTY_ROLE_VENDOR_TYPES[form.role] ?? [];
    if (!preferred.length) return vendors;
    const rank = (v) => {
      const i = preferred.indexOf(v.type);
      return i === -1 ? preferred.length : i;
    };
    return [...vendors].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [vendors, form.role]);

  const resetForm = () => {
    setForm({ role: "", vendorId: "", notes: "" });
    setAdding(false);
    setEditingId(null);
  };

  const submitAdd = async () => {
    if (!form.role || !form.vendorId) return toast.error("Pick a role and a party");
    setBusy(true);
    try {
      await addShipmentParty(shipmentId, {
        role: form.role,
        vendorId: form.vendorId,
        ...(form.notes ? { notes: form.notes } : {}),
      });
      toast.success("Party added");
      resetForm();
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not add the party");
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async (party) => {
    setBusy(true);
    try {
      await updateShipmentParty(shipmentId, party.id, { role: form.role, notes: form.notes || null });
      toast.success("Party updated");
      resetForm();
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not update the party");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (party) => {
    setBusy(true);
    try {
      await removeShipmentParty(shipmentId, party.id);
      toast.success("Party removed");
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not remove the party");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-border rounded-xl bg-card shadow-sm p-5">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <Building2 className="w-4 h-4" /> Parties
        </h2>
        {canManage && !adding && (
          <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => setAdding(true)}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading parties…
        </div>
      ) : (
        <>
          {parties.length === 0 && !adding && (
            <p className="text-sm text-muted-foreground">
              No parties recorded yet.
              {canManage ? " Add the exporter, the bank, the carrier and the clearing agent as they are confirmed." : ""}
            </p>
          )}

          <ul className="space-y-2">
            {parties.map((p) => {
              const editing = editingId === p.id;
              return (
                <li key={p.id} className="border rounded-lg p-3 text-sm">
                  {editing ? (
                    <div className="space-y-2">
                      <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Role" />
                        </SelectTrigger>
                        <SelectContent>
                          {PARTY_ROLE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="h-8 text-xs"
                        placeholder="Notes (optional)"
                        value={form.notes}
                        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" className="h-7 text-[11px]" disabled={busy} onClick={() => submitEdit(p)}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={busy} onClick={resetForm}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Badge variant="outline" className="text-[10px] mb-1">
                          {labelForPartyRole(p.role)}
                        </Badge>
                        <p className="font-medium truncate">{p.party?.name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.party?.referenceNo}
                          {p.partyKind === "vendor" && p.party?.type ? ` · ${VENDOR_TYPE_LABELS[p.party.type] ?? p.party.type}` : ""}
                          {p.party?.country ? ` · ${p.party.country}` : ""}
                        </p>
                        {/* Only rendered when the server actually sent them — a portal
                            customer receives neither. */}
                        {(p.party?.taxId || p.party?.rexNo || p.party?.iban) && (
                          <p className="text-[11px] text-muted-foreground mt-1 break-all">
                            {p.party.taxId ? `NTN ${p.party.taxId}` : ""}
                            {p.party.rexNo ? ` · REX ${p.party.rexNo}` : ""}
                            {p.party.iban ? ` · ${p.party.iban}` : ""}
                          </p>
                        )}
                        {p.notes && <p className="text-[11px] text-muted-foreground mt-1 italic">{p.notes}</p>}
                      </div>
                      {canManage && (
                        <div className="flex gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            aria-label="Edit party"
                            disabled={busy}
                            onClick={() => {
                              setEditingId(p.id);
                              setAdding(false);
                              setForm({ role: p.role, vendorId: p.vendorId ?? "", notes: p.notes ?? "" });
                            }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive"
                            aria-label="Remove party"
                            disabled={busy}
                            onClick={() => remove(p)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {adding && (
            <div className="border rounded-lg p-3 mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">New party</Label>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="Cancel" onClick={resetForm}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Role on this shipment" />
                </SelectTrigger>
                <SelectContent>
                  {PARTY_ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={form.vendorId} onValueChange={(v) => setForm((f) => ({ ...f, vendorId: v }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Party" />
                </SelectTrigger>
                <SelectContent>
                  {orderedVendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} · {VENDOR_TYPE_LABELS[v.type] ?? v.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-8 text-xs"
                placeholder="Notes (optional)"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
              <Button size="sm" className="h-7 text-[11px]" disabled={busy} onClick={submitAdd}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Add party"}
              </Button>
              <p className="text-[10px] text-muted-foreground">
                Any party can hold any role — the list is ordered by what this company usually is, not limited to it.
              </p>
            </div>
          )}

          {/* The server reports missing roles only for a shipment on the roadmap path
              (ADR-057), so an empty list is the whole signal — `shipmentKind` is no
              longer a gate here. */}
          {missingRoles.length > 0 && (
            <p className="text-[11px] text-amber-600 mt-3 flex items-start gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>Not yet named: {missingRoles.map(labelForPartyRole).join(", ")}</span>
            </p>
          )}

          {locked && (
            <p className="text-[11px] text-muted-foreground mt-3">
              {lockReason ?? "This shipment is locked — parties are read-only."}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default ShipmentPartiesPanel;
