import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createLead } from "@/services/leadService";
import { listCompanies } from "@/services/customerService";
import toast from "react-hot-toast";
import { UserPlus, Loader2, Search, Building2 } from "lucide-react";

const INITIAL = {
  companyName: "",
  country: "",
  city: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  contactPosition: "",
};

/**
 * AddLeadModal — company + contact are created here, once (RULE-LD-01).
 * Typing a company name searches existing companies (EDGE-LD-01 duplicate
 * detection): picking one links it; leaving free text creates it.
 */
const AddLeadModal = ({ onSuccess }) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(INITIAL);
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState([]);
  const [linkedCompany, setLinkedCompany] = useState(null); // existing company chosen
  const [linkedContactId, setLinkedContactId] = useState("");

  const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const searchCompanies = async (name) => {
    setForm((p) => ({ ...p, companyName: name }));
    setLinkedCompany(null);
    setLinkedContactId("");
    if (name.trim().length < 2) return setMatches([]);
    try {
      const res = await listCompanies(name);
      setMatches(res.data ?? []);
    } catch {
      /* search is best-effort */
    }
  };

  const pickCompany = (company) => {
    setLinkedCompany(company);
    setForm((p) => ({ ...p, companyName: company.name }));
    setMatches([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.companyName.trim() && !linkedCompany) return toast.error("Company is required");
    if (!linkedContactId && !form.contactName.trim()) return toast.error("Contact is required");

    setLoading(true);
    try {
      const payload = {
        ...(linkedCompany
          ? { companyId: linkedCompany.id }
          : {
              company: {
                name: form.companyName,
                country: form.country || undefined,
                city: form.city || undefined,
              },
            }),
        ...(linkedContactId
          ? { contactId: linkedContactId }
          : {
              contact: {
                name: form.contactName,
                email: form.contactEmail || undefined,
                phone: form.contactPhone || undefined,
                position: form.contactPosition || undefined,
              },
            }),
      };

      const res = await createLead(payload);
      if (res.duplicateWarning?.length) {
        toast(`Similar company already exists (${res.duplicateWarning.length}) — lead still created`, { icon: "⚠️" });
      }
      toast.success(`Lead ${res.data.referenceNo} created`);
      closeAndReset();
      onSuccess?.();
    } catch (err) {
      toast.error(err?.message || "Failed to create lead");
    } finally {
      setLoading(false);
    }
  };

  const closeAndReset = () => {
    setOpen(false);
    setForm(INITIAL);
    setMatches([]);
    setLinkedCompany(null);
    setLinkedContactId("");
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2 text-sm" size="sm">
        <UserPlus className="w-4 h-4" />
        Add Lead
      </Button>

      <Dialog open={open} onOpenChange={(v) => (!loading && !v ? closeAndReset() : setOpen(v))}>
        <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" />
              Add Lead
            </DialogTitle>
            <DialogDescription>
              Company and contact are created with the lead — conversion later only links them.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {/* Company with duplicate search */}
            <div className="space-y-1.5">
              <Label htmlFor="lead-company">Company</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="lead-company"
                  placeholder="Type to search or create…"
                  value={form.companyName}
                  onChange={(e) => searchCompanies(e.target.value)}
                  disabled={loading}
                  className="pl-9"
                  autoComplete="off"
                />
              </div>

              {matches.length > 0 && !linkedCompany && (
                <div className="border rounded-lg divide-y max-h-40 overflow-y-auto">
                  {matches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCompany(c)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition"
                    >
                      <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{c.city || c.country || ""}</span>
                    </button>
                  ))}
                </div>
              )}

              {linkedCompany && (
                <p className="text-xs text-green-600">
                  Linking existing company — its contacts are selectable below.
                </p>
              )}
            </div>

            {/* New-company extras */}
            {!linkedCompany && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lead-country">Country</Label>
                  <Input id="lead-country" name="country" value={form.country} onChange={handleChange} disabled={loading} placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lead-city">City</Label>
                  <Input id="lead-city" name="city" value={form.city} onChange={handleChange} disabled={loading} placeholder="Optional" />
                </div>
              </div>
            )}

            {/* Contact — pick existing (linked company) or create */}
            {linkedCompany && linkedCompany.contacts?.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="lead-existing-contact">Existing Contact</Label>
                <Select
                  value={linkedContactId || "new"}
                  onValueChange={(v) => setLinkedContactId(v === "new" ? "" : v)}
                  disabled={loading}
                  items={[{ value: "new", label: "＋ Create new contact" }, ...linkedCompany.contacts.map((c) => ({ value: c.id, label: `${c.name}${c.isPrimary ? " (primary)" : ""}` }))]}
                >
                  <SelectTrigger id="lead-existing-contact">
                    <SelectValue placeholder="Create new contact" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">＋ Create new contact</SelectItem>
                    {linkedCompany.contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}{c.isPrimary ? " (primary)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!linkedContactId && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="lead-contactName">Contact Name</Label>
                    <Input id="lead-contactName" name="contactName" value={form.contactName} onChange={handleChange} disabled={loading} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lead-contactPosition">Position</Label>
                    <Input id="lead-contactPosition" name="contactPosition" value={form.contactPosition} onChange={handleChange} disabled={loading} placeholder="Optional" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="lead-contactEmail">Contact Email</Label>
                    <Input id="lead-contactEmail" name="contactEmail" type="email" value={form.contactEmail} onChange={handleChange} disabled={loading} placeholder="Optional" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lead-contactPhone">Contact Phone</Label>
                    <Input id="lead-contactPhone" name="contactPhone" value={form.contactPhone} onChange={handleChange} disabled={loading} placeholder="Optional" />
                  </div>
                </div>
              </>
            )}

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeAndReset} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</> : "Create Lead"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AddLeadModal;
