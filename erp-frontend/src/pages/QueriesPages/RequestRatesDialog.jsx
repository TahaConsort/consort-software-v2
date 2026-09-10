import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Send, Check, Mail, Truck, X } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  Skeleton,
  Textarea,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import {
  VENDOR_TYPE_LABELS,
  VENDOR_TYPE_OPTIONS,
  labelForService,
  routeOf,
} from "@/lib/catalog";
import { listVendors, createVendor, requestVendorQuote } from "@/services/vendorService";

/**
 * Request rates — email the vendor directory about one query.
 *
 * This is a mail-out, not a tracked buy-side record: ops writes the ask once, fires it
 * at whichever vendors are worth asking, and the replies come back to their own inbox
 * (the server sets Reply-To to the requester). Nothing is stored, so a vendor can be
 * asked again the moment the brief changes.
 *
 * The message is written once and reused for every vendor on purpose — the ask is a
 * property of the job, not of the vendor, and re-typing it per vendor is how ops ends
 * up sending three subtly different briefs for the same lane.
 */

/** A vendor with no address on file cannot be emailed — the server rejects it with 422. */
const NEW_VENDOR = { name: "", type: "transporter", email: "", phone: "" };

const RequestRatesDialog = ({ query, onClose }) => {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");

  // Which vendor is mid-send, and everyone already asked in this sitting. `sent` is
  // presentation only: nothing is persisted, so reopening the dialog starts clean.
  const [sendingId, setSendingId] = useState(null);
  const [sent, setSent] = useState(() => new Set());

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(NEW_VENDOR);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listVendors({ isActive: true });
      setVendors(res.data || []);
    } catch (err) {
      toast.error(err?.message || "Could not load vendors");
    } finally {
      setLoading(false);
    }
  };

  // The first read is inlined rather than calling `load()`: that helper flips `loading`
  // synchronously, which inside an effect body is a cascading render. `loading` already
  // starts true, so the mount path only has to turn it off.
  useEffect(() => {
    let alive = true;
    listVendors({ isActive: true })
      .then((res) => {
        if (alive) setVendors(res.data || []);
      })
      .catch((err) => {
        if (alive) toast.error(err?.message || "Could not load vendors");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) =>
      [v.name, v.email, v.contactName, VENDOR_TYPE_LABELS[v.type] ?? v.type]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [vendors, search]);

  const send = async (vendor) => {
    setSendingId(vendor.id);
    try {
      const res = await requestVendorQuote(vendor.id, {
        queryId: query.id,
        message: message.trim() || undefined,
      });
      toast.success(res?.message || `Rate request emailed to ${vendor.email}`);
      setSent((prev) => new Set(prev).add(vendor.id));
    } catch (err) {
      toast.error(err?.message || "Could not send the email");
    } finally {
      setSendingId(null);
    }
  };

  const saveVendor = async (e) => {
    e.preventDefault();
    // Mirrors createVendorSchema: name, type, email and phone are all required, and a
    // vendor with no email could never be sent a rate request anyway.
    if (!form.name.trim()) return toast.error("Give the vendor a name");
    if (!form.email.trim()) return toast.error("An email address is required to request rates");
    if (!form.phone.trim()) return toast.error("A phone number is required");
    setSaving(true);
    try {
      const res = await createVendor({
        name: form.name.trim(),
        type: form.type,
        email: form.email.trim(),
        phone: form.phone.trim(),
      });
      const created = res?.data;
      toast.success(res?.message || `${form.name.trim()} added`);
      setForm(NEW_VENDOR);
      setAddOpen(false);
      // Put the new vendor at the top rather than refetching the whole directory, so
      // it is visible without hunting for it in a long alphabetical list.
      if (created?.id) setVendors((prev) => [created, ...prev]);
      else load();
    } catch (err) {
      toast.error(err?.message || "Could not add the vendor");
    } finally {
      setSaving(false);
    }
  };

  const route = routeOf(query);
  const busy = sendingId !== null || saving;

  return (
    <Modal isOpen onClose={() => !busy && onClose()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-2xl" className="flex max-h-[90vh] flex-col">
        <ModalHeader
          title={`Request rates for ${query.referenceNo}`}
          onClose={() => !busy && onClose()}
        />

        <ModalBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {/* What the vendor will be told. The customer is deliberately absent: vendor
              mail never carries who is buying, only what needs pricing. */}
          <div className="space-y-2 rounded-lg border border-border bg-accent p-3">
            {route && (
              <p className="text-sm font-medium leading-relaxed">{route}</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {(query.services ?? []).map((s) => (
                <Badge key={s} text={labelForService(s)} variant="soft" size="sm" />
              ))}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The reference, route and services above go out with every request. Replies
              come back to you, not to a shared mailbox.
            </p>
          </div>

          <Textarea
            label="Your message to the vendor"
            placeholder="e.g. 40ft HC, gate-out by 20 Sep. Please include detention free days and any local charges."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            minRows={3}
            maxLength={2000}
            disabled={busy}
            helperText="Written once and sent to every vendor you pick below. Optional, but a specific brief gets a usable price back."
          />

          {/* Directory */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <Input
                placeholder="Search vendors"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                prefixIcon={Search}
                disabled={loading}
                wrapperClassName="min-w-48 flex-1"
              />
              <Button
                type="button"
                size="sm"
                variant={addOpen ? "ghost" : "outline"}
                iconBefore={addOpen ? <X /> : <Plus />}
                onClick={() => setAddOpen((v) => !v)}
                disabled={busy}
              >
                {addOpen ? "Cancel" : "Add vendor"}
              </Button>
            </div>

            {addOpen && (
              <form
                onSubmit={saveVendor}
                className="space-y-3 rounded-lg border border-border p-3"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    size="sm"
                    label="Name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    disabled={saving}
                  />
                  <Select
                    size="sm"
                    label="Type"
                    value={form.type}
                    onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
                    options={VENDOR_TYPE_OPTIONS}
                    disabled={saving}
                  />
                  <Input
                    size="sm"
                    type="email"
                    label="Email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    disabled={saving}
                  />
                  <Input
                    size="sm"
                    label="Phone"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    disabled={saving}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={saving}
                    loading={saving}
                    loadingText="Saving…"
                  >
                    Save vendor
                  </Button>
                </div>
              </form>
            )}

            {loading ? (
              <div className="space-y-2">
                <Skeleton variant="rectangular" height={56} />
                <Skeleton variant="rectangular" height={56} />
                <Skeleton variant="rectangular" height={56} />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Truck className="h-5 w-5" />}
                title={search ? "No vendor matches that" : "No vendors yet"}
                description={
                  search
                    ? "Try a different name, or add the vendor you have in mind."
                    : "Add the first vendor to start asking for rates."
                }
              />
            ) : (
              <ul className="space-y-1.5">
                {filtered.map((v) => {
                  const alreadySent = sent.has(v.id);
                  const noEmail = !v.email;
                  return (
                    <li
                      key={v.id}
                      className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">{v.name}</span>
                          <Badge
                            variant="soft"
                            size="sm"
                            text={VENDOR_TYPE_LABELS[v.type] ?? v.type}
                          />
                          {alreadySent && (
                            <Badge
                              variant="soft"
                              size="sm"
                              text="Requested"
                              icon={<Check className="h-3 w-3" />}
                              className="whitespace-nowrap border border-success/30 bg-success/10 text-success"
                            />
                          )}
                        </div>
                        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" />
                          {v.email || "No email on file"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={alreadySent ? "outline" : "default"}
                        className="shrink-0"
                        iconBefore={<Send className="h-3.5 w-3.5" />}
                        disabled={busy || noEmail}
                        loading={sendingId === v.id}
                        loadingText="Sending…"
                        onClick={() => send(v)}
                      >
                        {alreadySent ? "Send again" : "Send request"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}

            {!loading && filtered.some((v) => !v.email) && (
              <Callout type="neutral">
                Vendors without an email address cannot be sent a request. Add one on the
                Vendors page and they will become selectable here.
              </Callout>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {sent.size > 0 ? "Done" : "Close"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default RequestRatesDialog;
