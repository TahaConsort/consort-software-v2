import { useState } from "react";
import {
  Button,
  Callout,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
} from "@neuctra/ui";
import { createLead } from "@/services/leadService";
import { listCompanies } from "@/services/customerService";
import toast from "react-hot-toast";
import { UserPlus, Search, Building2 } from "lucide-react";

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

  const handleChange = (e) =>
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

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
    if (!form.companyName.trim() && !linkedCompany)
      return toast.error("Company is required");
    if (!linkedContactId && !form.contactName.trim())
      return toast.error("Contact is required");

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
        toast(
          `Similar company already exists (${res.duplicateWarning.length}). The lead was still created.`,
        );
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

  const contactOptions = linkedCompany?.contacts?.length
    ? [
        { value: "new", label: "Create a new contact" },
        ...linkedCompany.contacts.map((c) => ({
          value: c.id,
          label: `${c.name}${c.isPrimary ? " (primary)" : ""}`,
        })),
      ]
    : [];

  return (
    <>
      <Button
        size="sm"
        className="px-3"
        onClick={() => setOpen(true)}
        iconBefore={<UserPlus className="h-4 w-4" />}
      >
        Add Lead
      </Button>

      {open && (
        <Modal
          isOpen
          onClose={() => !loading && closeAndReset()}
          disableOverlayClose={loading}
        >
          <ModalContent
            maxWidth="max-w-2xl"
            className="flex max-h-[90vh] flex-col"
          >
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
              <ModalHeader
                title="Add Lead"
                icon={<UserPlus className="h-5 w-5" />}
                onClose={() => !loading && closeAndReset()}
              />

              <ModalBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Company and contact are created with the lead. Converting it
                  later only links them.
                </p>

                {/* Company, with duplicate search */}
                <div className="space-y-1.5">
                  <Input
                    id="lead-company"
                    label="Company"
                    placeholder="Type to search or create…"
                    value={form.companyName}
                    onChange={(e) => searchCompanies(e.target.value)}
                    disabled={loading}
                    prefixIcon={Search}
                  />

                  {matches.length > 0 && !linkedCompany && (
                    <div className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
                      {matches.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => pickCompany(c)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{c.name}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {c.city || c.country || ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {linkedCompany && (
                    <Callout type="success">
                      Linking the existing company. Its contacts are selectable
                      below.
                    </Callout>
                  )}
                </div>

                {/* New-company extras */}
                {!linkedCompany && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input
                      id="lead-country"
                      name="country"
                      label="Country"
                      value={form.country}
                      onChange={handleChange}
                      disabled={loading}
                      placeholder="Optional"
                    />
                    <Input
                      id="lead-city"
                      name="city"
                      label="City"
                      value={form.city}
                      onChange={handleChange}
                      disabled={loading}
                      placeholder="Optional"
                    />
                  </div>
                )}

                {/* Contact — pick an existing one on a linked company, or create */}
                {contactOptions.length > 0 && (
                  <Select
                    label="Existing contact"
                    value={linkedContactId || "new"}
                    onValueChange={(v) =>
                      setLinkedContactId(v === "new" ? "" : v)
                    }
                    options={contactOptions}
                    disabled={loading}
                  />
                )}

                {!linkedContactId && (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Input
                        id="lead-contactName"
                        name="contactName"
                        label="Contact name"
                        value={form.contactName}
                        onChange={handleChange}
                        disabled={loading}
                      />
                      <Input
                        id="lead-contactPosition"
                        name="contactPosition"
                        label="Position"
                        value={form.contactPosition}
                        onChange={handleChange}
                        disabled={loading}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Input
                        id="lead-contactEmail"
                        name="contactEmail"
                        type="email"
                        label="Contact email"
                        value={form.contactEmail}
                        onChange={handleChange}
                        disabled={loading}
                        placeholder="Optional"
                      />
                      <Input
                        id="lead-contactPhone"
                        name="contactPhone"
                        label="Contact phone"
                        value={form.contactPhone}
                        onChange={handleChange}
                        disabled={loading}
                        placeholder="Optional"
                      />
                    </div>
                  </>
                )}
              </ModalBody>

              <ModalFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeAndReset}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  loading={loading}
                  loadingText="Creating…"
                >
                  Create Lead
                </Button>
              </ModalFooter>
            </form>
          </ModalContent>
        </Modal>
      )}
    </>
  );
};

export default AddLeadModal;
