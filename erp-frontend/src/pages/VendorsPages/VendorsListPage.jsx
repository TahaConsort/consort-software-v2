import { useEffect, useMemo, useState } from "react";
import {
  Truck,
  Plus,
  Pencil,
  Ban,
  Paperclip,
  Search,
  MessageSquare,
  Trash2,
  RefreshCw,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  Skeleton,
  TBody,
  TD,
  TH,
  THead,
  TRow,
  Table,
  Tooltip,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import {
  VENDOR_TYPE_LABELS,
  VENDOR_TYPE_OPTIONS,
  vendorTypeOptionsFor,
  DEFAULT_CURRENCY,
} from "@/lib/catalog";
import DocumentsDialog from "@/components/DocumentsDialog";
import { useAuthStore } from "@/store/authStore";
import {
  listVendors,
  createVendor,
  updateVendor,
  deactivateVendor,
  deleteVendor,
  requestVendorQuote,
} from "@/services/vendorService";

const EMPTY = {
  name: "",
  type: "exporter",
  contactName: "",
  email: "",
  phone: "",
  city: "",
  country: "",
  taxId: "",
  paymentTermsDays: "",
  currency: "",
  strn: "",
  rexNo: "",
  vatNo: "",
  bankName: "",
  bankBranch: "",
  iban: "",
  swiftCode: "",
  accountTitle: "",
  website: "",
  notes: "",
};

/**
 * One chip recipe for the whole directory. There are fourteen vendor types and four
 * status tokens, so type is deliberately NOT colour-coded: it is context, not state,
 * and fourteen competing hues turned the column into a paint chart. The only coloured
 * chip here is the one that carries meaning — whether the vendor is still active.
 */
const CHIP = "whitespace-nowrap border text-xs";
const NEUTRAL_CHIP = "border-border bg-muted text-muted-foreground";

/** One 36px baseline across the toolbar and the row actions. */
const ACTION_BTN = "h-9 px-3";
const ACTION_ICON_BTN = "h-9 w-9 shrink-0 p-0";

/**
 * TH/TD merge their className with plain clsx and hardcode their own padding, so a
 * padding utility from here is a coin-flip on stylesheet order — `style` is the only
 * deterministic route.
 */
const HEAD_CELL = { padding: "1rem 1.5rem" };
const CELL = { padding: "1rem 1.5rem" };
/**
 * `maxWidth: 0` hands a table-fixed cell its width from the column percentage rather
 * than from its content, and only clips once overflow is hidden as well.
 */
const CLIP = { minWidth: 0, maxWidth: 0, overflow: "hidden" };

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "All types" },
  ...VENDOR_TYPE_OPTIONS,
];

/** Icon-only row action, so five controls fit one column without wrapping. */
const RowAction = ({ title, onClick, disabled, danger, children }) => (
  <Tooltip content={title}>
    <span className="inline-flex shrink-0">
      <IconButton
        variant="ghost"
        className={`${ACTION_ICON_BTN} text-muted-foreground ${
          danger
            ? "hover:bg-destructive/10 hover:text-destructive"
            : "hover:text-foreground"
        }`}
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
        icon={children}
      />
    </span>
  </Tooltip>
);

/** A labelled group inside the create/edit form. */
const FormSection = ({ title, children }) => (
  <section className="space-y-4">
    <h4 className="border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
    </h4>
    {children}
  </section>
);

/**
 * VendorsListPage — the single directory of every counterparty on a shipment.
 *
 * One page, filtered by type. The per-type sub-screens it replaced were the same
 * component with a locked filter, which meant three routes and a `lockedType` branch
 * through the form for something the filter already does.
 */
export default function VendorsListPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission("vendor.manage");
  // Emailing for rates is a buy-side action, gated the same way the server gates it.
  const canRequestQuote = hasPermission("rfq.manage");

  const [vendors, setVendors] = useState(null);
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  // Which filter the rows in state belong to. Adjusted during render (React's documented
  // adjust-state-on-prop-change pattern) so switching type blanks the previous result set
  // immediately, without a setState inside an effect.
  const [loadedFilter, setLoadedFilter] = useState(typeFilter);
  if (loadedFilter !== typeFilter) {
    setLoadedFilter(typeFilter);
    setVendors(null);
  }
  // Derived, so a background refetch never has to flip a flag on the way in.
  const loading = vendors === null;
  const [searchQuery, setSearchQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // vendor being edited, or null for create
  const [form, setForm] = useState(EMPTY);
  const [docsFor, setDocsFor] = useState(null); // vendor whose documents are open
  const [vendorToDelete, setVendorToDelete] = useState(null);

  // Rate-request email: the vendor being asked, and the optional note that rides along.
  const [quoteFor, setQuoteFor] = useState(null);
  const [quoteMessage, setQuoteMessage] = useState("");

  /** Re-read after a write, or from the Refresh button. */
  const load = async () => {
    try {
      const res = await listVendors(
        typeFilter === "all" ? {} : { type: typeFilter },
      );
      setVendors(res.data || []);
    } catch (err) {
      setVendors([]);
      toast.error(err?.message || "Could not load vendors");
    }
  };

  // The type filter is server-side, so a change refetches. Nothing is set synchronously
  // here: `vendors` was already blanked during the render that saw the filter change.
  useEffect(() => {
    let alive = true;
    listVendors(typeFilter === "all" ? {} : { type: typeFilter })
      .then((res) => {
        if (alive) setVendors(res.data || []);
      })
      .catch((err) => {
        if (!alive) return;
        setVendors([]);
        toast.error(err?.message || "Could not load vendors");
      });
    return () => {
      alive = false;
    };
  }, [typeFilter]);

  const filteredVendors = useMemo(() => {
    if (!vendors) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) =>
      [v.name, v.referenceNo, v.contactName, v.email, v.city, v.country]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [vendors, searchQuery]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (v) => {
    setEditing(v);
    setForm({
      name: v.name ?? "",
      type: v.type,
      contactName: v.contactName ?? "",
      email: v.email ?? "",
      phone: v.phone ?? "",
      city: v.city ?? "",
      country: v.country ?? "",
      taxId: v.taxId ?? "",
      paymentTermsDays: v.paymentTermsDays ?? "",
      currency: v.currency ?? "",
      strn: v.strn ?? "",
      rexNo: v.rexNo ?? "",
      vatNo: v.vatNo ?? "",
      bankName: v.bankName ?? "",
      bankBranch: v.bankBranch ?? "",
      iban: v.iban ?? "",
      swiftCode: v.swiftCode ?? "",
      accountTitle: v.accountTitle ?? "",
      website: v.website ?? "",
      notes: v.notes ?? "",
    });
    setOpen(true);
  };

  const set = (key) => (e) =>
    setForm((p) => ({ ...p, [key]: e.target.value }));

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
        paymentTermsDays:
          form.paymentTermsDays === ""
            ? undefined
            : Number(form.paymentTermsDays),
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
      const res = editing
        ? await updateVendor(editing.id, payload)
        : await createVendor(payload);
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

  /**
   * Ask a vendor for rates by email. This opens a confirm step rather than sending on
   * the click: the mail leaves the building the moment it is sent, and there is no
   * unsend — so the address being mailed is shown before it goes.
   */
  const handleGetQuote = (v) => {
    if (!v.email)
      return toast.error(`${v.name} has no email address on file. Add one first.`);
    setQuoteMessage("");
    setQuoteFor(v);
  };

  const sendQuoteRequest = async () => {
    if (!quoteFor) return;
    setBusy(true);
    try {
      const res = await requestVendorQuote(quoteFor.id, {
        message: quoteMessage.trim() || undefined,
      });
      toast.success(res?.message || `Rate request emailed to ${quoteFor.email}`);
      setQuoteFor(null);
    } catch (err) {
      toast.error(err?.message || "Could not send the rate request");
    } finally {
      setBusy(false);
    }
  };

  const filtersActive = !!(searchQuery || typeFilter !== "all");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Vendors
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every counterparty involved in a shipment
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={ACTION_BTN}
            onClick={() => {
              setVendors(null);
              load();
            }}
            disabled={loading}
            iconBefore={
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            }
          >
            Refresh
          </Button>
          {canManage && (
            <Button
              size="sm"
              className={ACTION_BTN}
              onClick={openCreate}
              iconBefore={<Plus className="h-4 w-4" />}
            >
              Add Vendor
            </Button>
          )}
        </div>
      </div>

      {/* Filters. Fourteen types is far too many for a pill row, so the type lives in a
          Select beside the search, on the same baseline as the toolbar above. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search name, ref, contact or location…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          prefixIcon={Search}
          wrapperClassName="min-w-56 flex-1"
        />
        <Select
          size="md"
          value={typeFilter}
          onValueChange={setTypeFilter}
          options={TYPE_FILTER_OPTIONS}
          placeholder="Type"
          showCheckIcon={false}
          searchable
          className="w-52!"
          containerClassName="w-52"
          triggerClassName="h-9"
        />
      </div>

      {/* EmptyState brings its own padding and icon sizing, so the Card only supplies
          the surface. The empty case replaces the table rather than living inside it:
          TD carries no `colSpan`, so a spanning "nothing here" row is not expressible. */}
      {!loading && filteredVendors.length === 0 ? (
        <Card padding="none">
          <EmptyState
            size="lg"
            icon={<Truck />}
            title={filtersActive ? "No vendors match" : "No vendors yet"}
            description={
              filtersActive
                ? "Try a different search, or widen the type filter."
                : "Add the counterparties you book, clear and haul through."
            }
            action={
              !filtersActive && canManage ? (
                <Button
                  size="sm"
                  onClick={openCreate}
                  iconBefore={<Plus className="h-4 w-4" />}
                >
                  Add Vendor
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="w-full min-w-0">
          <div className="w-full overflow-x-auto">
            <Table className="w-full min-w-0 table-fixed" bordered dense>
              <THead>
                <TRow>
                  <TH style={{ ...HEAD_CELL, width: "24%" }}>Vendor</TH>
                  <TH
                    className="hidden md:table-cell"
                    style={{ ...HEAD_CELL, width: "15%" }}
                  >
                    Type
                  </TH>
                  <TH
                    className="hidden lg:table-cell"
                    style={{ ...HEAD_CELL, width: "18%" }}
                  >
                    Contact
                  </TH>
                  <TH
                    className="hidden sm:table-cell"
                    style={{ ...HEAD_CELL, width: "13%" }}
                  >
                    Location
                  </TH>
                  <TH
                    className="hidden xl:table-cell"
                    style={{ ...HEAD_CELL, width: "10%" }}
                  >
                    Terms
                  </TH>
                  <TH style={{ ...HEAD_CELL, width: "20%", textAlign: "right" }}>
                    Actions
                  </TH>
                </TRow>
              </THead>

              <TBody>
                {/* LOADING */}
                {loading &&
                  [...Array(5)].map((_, i) => (
                    <TRow key={i}>
                      {[...Array(6)].map((_, j) => (
                        <TD key={j} style={{ ...CELL, ...CLIP }}>
                          <Skeleton width="70%" height={16} />
                        </TD>
                      ))}
                    </TRow>
                  ))}

                {/* DATA */}
                {!loading &&
                  filteredVendors.map((v) => (
                    <TRow
                      key={v.id}
                      className={`bg-card! ${v.isActive ? "" : "opacity-60"}`}
                    >
                      <TD style={{ ...CELL, ...CLIP }}>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{v.name}</span>
                          {!v.isActive && (
                            <Badge
                              variant="soft"
                              size="sm"
                              text="Inactive"
                              className={`${CHIP} border-warning/30 bg-warning/10 text-warning`}
                            />
                          )}
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {v.referenceNo}
                        </div>
                      </TD>

                      <TD
                        className="hidden md:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        <Badge
                          variant="soft"
                          size="sm"
                          text={VENDOR_TYPE_LABELS[v.type] ?? v.type}
                          className={`${CHIP} ${NEUTRAL_CHIP}`}
                        />
                      </TD>

                      <TD
                        className="hidden lg:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        <div className="truncate">
                          {v.contactName || "No contact named"}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {v.email || v.phone || "No details"}
                        </div>
                      </TD>

                      <TD
                        className="hidden truncate text-muted-foreground sm:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {[v.city, v.country].filter(Boolean).join(", ") ||
                          "Not set"}
                      </TD>

                      <TD
                        className="hidden xl:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        <div className="truncate">
                          {v.paymentTermsDays != null
                            ? `${v.paymentTermsDays} days`
                            : "Not set"}
                        </div>
                        {v.currency && (
                          <div className="truncate text-xs text-muted-foreground">
                            {v.currency}
                          </div>
                        )}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP, textAlign: "right" }}>
                        <div className="flex min-w-0 items-center justify-end gap-1.5">
                          <RowAction
                            title="Documents"
                            onClick={() => setDocsFor(v)}
                          >
                            <Paperclip className="h-4 w-4" />
                          </RowAction>

                          {canRequestQuote && (
                            <RowAction
                              title={
                                v.email
                                  ? `Email ${v.email} for rates`
                                  : "No email address on file"
                              }
                              disabled={busy}
                              onClick={() => handleGetQuote(v)}
                            >
                              <MessageSquare className="h-4 w-4" />
                            </RowAction>
                          )}

                          {canManage && (
                            <>
                              <RowAction
                                title="Edit vendor"
                                onClick={() => openEdit(v)}
                              >
                                <Pencil className="h-4 w-4" />
                              </RowAction>

                              {v.isActive && (
                                <RowAction
                                  title="Deactivate"
                                  disabled={busy}
                                  onClick={() => handleDeactivate(v)}
                                >
                                  <Ban className="h-4 w-4" />
                                </RowAction>
                              )}

                              <RowAction
                                title="Delete permanently"
                                danger
                                disabled={busy}
                                onClick={() => setVendorToDelete(v)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </RowAction>
                            </>
                          )}
                        </div>
                      </TD>
                    </TRow>
                  ))}
              </TBody>
            </Table>
          </div>
        </div>
      )}

      {/* Rate-request email — confirm before it leaves, since there is no unsend. */}
      {quoteFor && (
        <Modal
          isOpen
          onClose={() => !busy && setQuoteFor(null)}
          disableOverlayClose={busy}
        >
          <ModalContent maxWidth="max-w-md">
            <ModalHeader
              title={`Request rates from ${quoteFor.name}`}
              onClose={() => !busy && setQuoteFor(null)}
            />
            <ModalBody className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                An email goes to{" "}
                <b className="text-foreground">{quoteFor.email}</b>. Replies come
                back to you, not to the shared mailbox.
              </p>
              <Input
                id="v-quote-msg"
                label="Add a note (optional)"
                value={quoteMessage}
                onChange={(e) => setQuoteMessage(e.target.value)}
                placeholder="e.g. Karachi to Antwerp, 1x40HC, ready 12 Oct"
                disabled={busy}
                helperText="Included in the vendor's copy above the sign-off. Leave blank to send the standard request."
              />
            </ModalBody>
            <ModalFooter>
              <Button
                variant="outline"
                onClick={() => setQuoteFor(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                onClick={sendQuoteRequest}
                disabled={busy}
                loading={busy}
                loadingText="Sending…"
                iconBefore={<MessageSquare className="h-4 w-4" />}
              >
                Send request
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {/* Delete confirmation */}
      {vendorToDelete && (
        <Modal
          isOpen
          onClose={() => !busy && setVendorToDelete(null)}
          disableOverlayClose={busy}
        >
          <ModalContent maxWidth="max-w-md">
            <ModalHeader
              title="Delete Vendor"
              onClose={() => !busy && setVendorToDelete(null)}
            />
            <ModalBody>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Permanently delete{" "}
                <b className="text-foreground">{vendorToDelete.name}</b>? This
                cannot be undone. Deactivating keeps the record and its history
                instead.
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="outline"
                onClick={() => setVendorToDelete(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={busy}
                loading={busy}
                loadingText="Deleting…"
                iconBefore={<Trash2 className="h-4 w-4" />}
              >
                Delete
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {/* Create / edit */}
      {open && (
        <Modal
          isOpen
          onClose={() => !busy && setOpen(false)}
          disableOverlayClose={busy}
        >
          <ModalContent
            maxWidth="max-w-3xl"
            className="flex max-h-[90vh] flex-col"
          >
            <form onSubmit={submit} className="flex min-h-0 flex-col">
              <ModalHeader
                title={editing ? "Edit Vendor Profile" : "Create New Vendor"}
                onClose={() => !busy && setOpen(false)}
              />

              <ModalBody className="min-h-0 flex-1 space-y-6 overflow-y-auto">
                <FormSection title="Basic info">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                      id="v-name"
                      label="Vendor name"
                      required
                      value={form.name}
                      onChange={set("name")}
                      placeholder="e.g. Agilent Freight Services"
                      disabled={busy}
                    />
                    {/* Editing a vendor filed under a dropped type keeps that type in
                        the list, so opening the form cannot silently rewrite it. */}
                    <Select
                      label="Type"
                      value={form.type}
                      onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}
                      options={vendorTypeOptionsFor(editing?.type)}
                      searchable
                      disabled={busy}
                    />
                  </div>
                </FormSection>

                <FormSection title="Contact and location">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Input
                      id="v-contact"
                      label="Primary contact"
                      value={form.contactName}
                      onChange={set("contactName")}
                      placeholder="e.g. John Doe"
                      disabled={busy}
                    />
                    <Input
                      id="v-email"
                      type="email"
                      label="Email address"
                      required
                      value={form.email}
                      onChange={set("email")}
                      placeholder="e.g. contact@example.com"
                      disabled={busy}
                    />
                    <Input
                      id="v-phone"
                      label="Phone number"
                      required
                      value={form.phone}
                      onChange={set("phone")}
                      placeholder="e.g. +92 300 1234567"
                      disabled={busy}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                      id="v-city"
                      label="City"
                      value={form.city}
                      onChange={set("city")}
                      placeholder="City, area…"
                      disabled={busy}
                    />
                    <Input
                      id="v-country"
                      label="Country"
                      value={form.country}
                      onChange={set("country")}
                      placeholder="PK"
                      disabled={busy}
                    />
                  </div>
                </FormSection>

                <FormSection title="Registration and terms">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Input
                      id="v-tax"
                      label="Tax ID (NTN)"
                      value={form.taxId}
                      onChange={set("taxId")}
                      placeholder="e.g. 1234567-8"
                      disabled={busy}
                    />
                    <Input
                      id="v-strn"
                      label="STRN"
                      value={form.strn}
                      onChange={set("strn")}
                      placeholder="e.g. 12-00-9805"
                      disabled={busy}
                    />
                    <Input
                      id="v-rex"
                      label="REX No."
                      value={form.rexNo}
                      onChange={set("rexNo")}
                      placeholder="e.g. PKREX…"
                      disabled={busy}
                    />
                    <Input
                      id="v-vat"
                      label="VAT / TVA No."
                      value={form.vatNo}
                      onChange={set("vatNo")}
                      placeholder="e.g. FR029…"
                      disabled={busy}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                      id="v-terms"
                      type="number"
                      label="Payment terms (days)"
                      min={0}
                      value={String(form.paymentTermsDays)}
                      onChange={set("paymentTermsDays")}
                      placeholder="e.g. 30"
                      disabled={busy}
                    />
                    <Input
                      id="v-ccy"
                      label="Default currency"
                      maxLength={3}
                      value={form.currency}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          currency: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder={DEFAULT_CURRENCY}
                      disabled={busy}
                    />
                  </div>
                </FormSection>

                <FormSection title="Banking details">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                      id="v-bank-name"
                      label="Bank name"
                      value={form.bankName}
                      onChange={set("bankName")}
                      placeholder="e.g. Meezan Bank"
                      disabled={busy}
                    />
                    <Input
                      id="v-bank-branch"
                      label="Branch"
                      value={form.bankBranch}
                      onChange={set("bankBranch")}
                      placeholder="e.g. Jail Road"
                      disabled={busy}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Input
                      id="v-account-title"
                      label="Account title"
                      value={form.accountTitle}
                      onChange={set("accountTitle")}
                      placeholder="e.g. Agilent Freight"
                      disabled={busy}
                    />
                    <Input
                      id="v-iban"
                      label="IBAN / account no."
                      value={form.iban}
                      onChange={set("iban")}
                      placeholder="e.g. PK11MEZN…"
                      disabled={busy}
                    />
                    <Input
                      id="v-swift"
                      label="SWIFT code"
                      value={form.swiftCode}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          swiftCode: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="e.g. MEZNPKKA"
                      disabled={busy}
                    />
                  </div>
                </FormSection>

                <FormSection title="Additional">
                  <Input
                    id="v-website"
                    type="url"
                    label="Website"
                    value={form.website}
                    onChange={set("website")}
                    placeholder="https://"
                    disabled={busy}
                  />
                  <Input
                    id="v-notes"
                    label="Internal notes"
                    value={form.notes}
                    onChange={set("notes")}
                    placeholder="Anything the desk should know"
                    disabled={busy}
                  />
                </FormSection>
              </ModalBody>

              <ModalFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy}
                  loading={busy}
                  loadingText="Saving…"
                >
                  {editing ? "Save Changes" : "Create Vendor"}
                </Button>
              </ModalFooter>
            </form>
          </ModalContent>
        </Modal>
      )}

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
