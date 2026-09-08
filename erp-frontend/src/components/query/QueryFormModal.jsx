import { useMemo, useState } from "react";
import { Plus, Save } from "lucide-react";
import {
  Button,
  Checkbox,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  TagInput,
  ToggleGroup,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import { SERVICE_OPTIONS } from "@/lib/catalog";

/**
 * @neuctra/ui puts a label on its own fields but has no standalone Label export,
 * so headings for the grouped controls are rendered with its label styling.
 */
const FieldLabel = ({ children }) => (
  <span className="mb-1.5 block text-[13px] font-medium leading-none text-foreground">
    {children}
  </span>
);

/**
 * The one query form — create AND edit, used by the admin Queries page and the customer
 * portal. A query is a plain enquiry: who is asking, where the goods move from and to,
 * and which services they want.
 *
 * `services` is free text on the wire. The catalog is offered as checkboxes because it
 * is what Ops prices against, but anything typed into the tag field rides along too.
 *
 * Props
 *  - mode              "create" | "edit"
 *  - initial           existing query when editing (or a partial prefill on create)
 *  - customers         list for the picker; omit entirely for the portal
 *  - presetCustomerId  preselect this customer
 *  - lockCustomer      hide the picker (portal users are scoped to their own customer)
 *  - busy              disables the form while the mutation is in flight
 *  - onClose / onSubmit
 */
const QueryFormModal = ({
  mode = "create",
  initial = null,
  customers = [],
  presetCustomerId,
  lockCustomer = false,
  busy = false,
  onClose,
  onSubmit,
}) => {
  const isEdit = mode === "edit";

  const [form, setForm] = useState(() => ({
    customerId: initial?.customerId ?? presetCustomerId ?? "",
    customerName: initial?.customerName ?? "",
    customerEmail: initial?.customerEmail ?? "",
    customerPhone: initial?.customerPhone ?? "",
    pickupAddress: initial?.pickupAddress ?? "",
    destinationAddress: initial?.destinationAddress ?? "",
    services: initial?.services ?? [],
    // Only sent when customerMode === "new".
    companyName: "",
    country: "",
  }));
  // "existing" picks a customer we already serve; "new" mints one with this query.
  const [customerMode, setCustomerMode] = useState("existing");

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  const activeCustomers = useMemo(() => customers.filter((c) => c.isActive), [customers]);
  const customerItems = useMemo(
    () => activeCustomers.map((c) => ({ value: c.id, label: `${c.referenceNo} — ${c.companyName}` })),
    [activeCustomers],
  );

  /**
   * Picking a customer prefills the contact fields, but only the ones still untouched —
   * a BDO who has already typed the person who actually called must not lose it.
   */
  const chooseCustomer = (id) => {
    const c = activeCustomers.find((x) => x.id === id);
    setForm((p) => ({
      ...p,
      customerId: id,
      customerName: p.customerName || c?.primaryContactName || c?.companyName || "",
      customerEmail: p.customerEmail || c?.primaryContactEmail || "",
      customerPhone: p.customerPhone || c?.primaryContactPhone || "",
    }));
  };

  const switchCustomerMode = (next) => {
    setCustomerMode(next);
    // Never carry a picked customer into the "new" branch, or a typed company
    // name back into the picker — only one is ever submitted.
    set(next === "new" ? { customerId: "" } : { companyName: "", country: "" });
  };

  // Anything on the query that isn't one of the catalog codes was typed by hand.
  // The checkbox group owns the catalog half, the tag field owns this half.
  const catalogCodes = SERVICE_OPTIONS.map((s) => s.value);
  const catalogServices = form.services.filter((s) => catalogCodes.includes(s));
  const customServices = form.services.filter((s) => !catalogCodes.includes(s));

  const closeIfIdle = () => {
    if (!busy) onClose();
  };

  const submit = (e) => {
    e.preventDefault();
    const addingCustomer = !lockCustomer && !isEdit && customerMode === "new";
    if (!lockCustomer && !isEdit && !addingCustomer && !form.customerId) {
      return toast.error("Pick a customer, or switch to Enter new customer");
    }
    if (addingCustomer && form.companyName.trim().length < 2) {
      return toast.error("Enter the company name");
    }
    if (!form.customerName.trim()) return toast.error("Enter the customer name");
    if (!form.customerEmail.trim()) return toast.error("Enter an email address");
    if (!form.customerPhone.trim()) return toast.error("Enter a phone number");
    if (!form.pickupAddress.trim()) return toast.error("Enter a pickup address");
    if (!form.destinationAddress.trim()) return toast.error("Enter a destination address");
    if (!form.services.length) return toast.error("Select at least one service");

    const payload = {
      customerName: form.customerName.trim(),
      customerEmail: form.customerEmail.trim(),
      customerPhone: form.customerPhone.trim(),
      pickupAddress: form.pickupAddress.trim(),
      destinationAddress: form.destinationAddress.trim(),
      services: form.services,
    };
    // The customer a query belongs to is fixed at creation — the API rejects it on update.
    // Send EITHER the customer we picked or the one to mint, never both.
    if (!isEdit && !lockCustomer) {
      if (addingCustomer) {
        payload.newCustomer = {
          companyName: form.companyName.trim(),
          ...(form.country.trim() ? { country: form.country.trim() } : {}),
        };
      } else {
        payload.customerId = form.customerId;
      }
    }
    onSubmit(payload);
  };

  return (
    <Modal isOpen onClose={closeIfIdle} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-2xl" className="flex max-h-[90vh] flex-col">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <ModalHeader title={isEdit ? "Edit Query" : "New Query"} onClose={closeIfIdle} />

          <ModalBody className="min-h-0 flex-1 overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              {isEdit
                ? "Update the enquiry. Only an open query can be edited."
                : "Capture the enquiry — who is asking, where it moves from and to, and what they need."}
            </p>

            {!lockCustomer && !isEdit && (
              <div>
                <FieldLabel>Customer</FieldLabel>
                {/* Either pick one we already serve, or just type the details — a BDO
                    taking a call from a new company should not have to leave the form. */}
                <ToggleGroup
                  type="single"
                  size="sm"
                  fullWidth
                  value={customerMode}
                  disabled={busy}
                  options={[
                    { value: "existing", label: "Choose customer" },
                    { value: "new", label: "Enter new customer" },
                  ]}
                  // The segmented control clears itself when the active segment is
                  // clicked. There is no "neither" state here, so ignore the empty value.
                  onChange={(next) => next && switchCustomerMode(next)}
                />

                {customerMode === "existing" ? (
                  <div className="pt-2">
                    <Select
                      value={form.customerId}
                      onValueChange={chooseCustomer}
                      options={customerItems}
                      placeholder="Select customer…"
                      searchable
                      searchPlaceholder="Search by name or reference…"
                      maxDropdownHeight={240}
                      disabled={busy}
                    />
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
                    <Input
                      id="q-company"
                      label="Company name"
                      value={form.companyName}
                      onChange={(e) => set({ companyName: e.target.value })}
                      placeholder="Who we will be invoicing"
                      disabled={busy}
                    />
                    <Input
                      id="q-country"
                      label="Country (optional)"
                      value={form.country}
                      onChange={(e) => set({ country: e.target.value })}
                      placeholder="Pakistan"
                      disabled={busy}
                    />
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      The customer record is created with this query, using the contact
                      details below. An existing company of the same name is reused.
                    </p>
                  </div>
                )}
              </div>
            )}

            {isEdit && (
              <p className="text-xs text-muted-foreground">
                A query stays with the customer it was raised for.
              </p>
            )}

            <Input
              id="q-name"
              label="Customer name"
              value={form.customerName}
              onChange={(e) => set({ customerName: e.target.value })}
              placeholder="Who is asking"
              disabled={busy}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                id="q-email"
                type="email"
                label="Email"
                value={form.customerEmail}
                onChange={(e) => set({ customerEmail: e.target.value })}
                placeholder="name@company.com"
                disabled={busy}
              />
              <Input
                id="q-phone"
                type="tel"
                label="Phone number"
                value={form.customerPhone}
                onChange={(e) => set({ customerPhone: e.target.value })}
                placeholder="0300-0000000"
                disabled={busy}
              />
            </div>

            <Input
              id="q-pickup"
              label="Pickup address / location"
              value={form.pickupAddress}
              onChange={(e) => set({ pickupAddress: e.target.value })}
              placeholder="Where the goods are collected"
              disabled={busy}
            />

            <Input
              id="q-destination"
              label="Destination address / location"
              value={form.destinationAddress}
              onChange={(e) => set({ destinationAddress: e.target.value })}
              placeholder="Where the goods are delivered"
              disabled={busy}
            />

            <div>
              <FieldLabel>Services</FieldLabel>
              <Checkbox
                mode="group"
                options={SERVICE_OPTIONS}
                selectedValues={form.services}
                // The group toggles against the whole array it is given, so the
                // hand-typed services below ride through it untouched.
                onChange={(services) => set({ services })}
                disabled={busy}
                className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-2"
                // A group item is laid out `justify-between`, which inside a grid cell
                // throws the box to the far right, a column away from the label it
                // belongs to. Reversing the row pulls it back against its text.
                // `relative` anchors the sr-only input — which is absolutely
                // positioned — to its own row rather than to ModalContent, so
                // focusing it cannot scroll the body out from under the pointer.
                itemClassName="relative flex-row-reverse justify-end gap-2.5"
              />

              <div className="pt-3">
                <TagInput
                  value={customServices}
                  onChange={(custom) => set({ services: [...catalogServices, ...custom] })}
                  placeholder="Other service — type and press Enter…"
                  helperText="Anything the catalog above does not cover."
                  disabled={busy}
                />
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              loading={busy}
              loadingText={isEdit ? "Saving…" : "Creating…"}
              iconBefore={isEdit ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            >
              {isEdit ? "Save Changes" : "Create Query"}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

export default QueryFormModal;
