import { useEffect, useState } from "react";
import { IdCard, RefreshCw, Plus, Pencil, Ban, Paperclip, Save } from "lucide-react";
import toast from "react-hot-toast";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  TBody,
  TD,
  TH,
  THead,
  TRow,
  Table,
  Tooltip,
} from "@neuctra/ui";
import DocumentsDialog from "@/components/DocumentsDialog";
import { useAuthStore } from "@/store/authStore";
import {
  listDrivers,
  createDriver,
  updateDriver,
  deactivateDriver,
} from "@/services/fleetService";

const EMPTY = { name: "", phone: "", cnic: "", licenseNo: "" };

/** One 36px baseline across the toolbar and the row actions. */
const ACTION_BTN = "h-9 px-3";
const ACTION_ICON_BTN = "h-9 w-9 shrink-0 p-0";

const CHIP = "whitespace-nowrap border text-xs";
const NEUTRAL_CHIP = "border-border bg-muted text-muted-foreground";
const SUCCESS_CHIP = "border-success/30 bg-success/10 text-success";

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

// Stored digits-only; shown the way it is printed on the card.
const prettyCnic = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 13
    ? `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`
    : v || "—";
};

/** Icon-only row action, so three controls fit one column without wrapping. */
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

/**
 * Drivers — own-fleet master. Four identifying fields and the paperwork that
 * proves them (CNIC, licence), which is what the Docs button is for.
 * Read: fleet.read; manage: fleet.manage.
 */
export default function DriversListPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission("fleet.manage");

  // `null` means "not answered yet", which is what drives the skeleton. Deriving it
  // beats a loading flag that `load` would have to set synchronously — the thing that
  // made the mount effect trip react-hooks/set-state-in-effect before.
  const [drivers, setDrivers] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [docsFor, setDocsFor] = useState(null); // driver whose documents are open

  const loading = drivers === null;

  const load = async () => {
    try {
      const res = await listDrivers();
      setDrivers(res.data || []);
    } catch (err) {
      // Settle the list either way, or a failed first load leaves the skeleton up forever.
      setDrivers((prev) => prev ?? []);
      toast.error(err?.message || "Could not load drivers");
    }
  };

  // Only the button shows a spinner: the first load already has the skeleton.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * The first read is inlined rather than calling `load()`: the lint rule treats any
   * call into a function that touches setState as a synchronous effect write, whatever
   * the await ordering. Settling inside the promise callbacks — behind an `alive` guard
   * so a fast unmount cannot write to a dead component — is the shape it accepts.
   */
  useEffect(() => {
    let alive = true;
    listDrivers()
      .then((res) => {
        if (alive) setDrivers(res.data || []);
      })
      .catch((err) => {
        if (!alive) return;
        setDrivers([]);
        toast.error(err?.message || "Could not load drivers");
      });
    return () => {
      alive = false;
    };
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (d) => {
    setEditing(d);
    setForm({
      name: d.name ?? "",
      phone: d.phone ?? "",
      cnic: d.cnic ?? "",
      licenseNo: d.licenseNo ?? "",
    });
    setOpen(true);
  };

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

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
      const res = editing
        ? await updateDriver(editing.id, payload)
        : await createDriver(payload);
      toast.success(res?.message || "Saved");
      setOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not save driver");
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

  const rows = drivers ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <IdCard className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Drivers
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Own-fleet drivers: identity, licence and their scanned paperwork
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={ACTION_BTN}
            onClick={refresh}
            disabled={loading || refreshing}
            iconBefore={
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
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
              New driver
            </Button>
          )}
        </div>
      </div>

      {!loading && rows.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<IdCard />}
              title="No drivers yet"
              description={
                canManage
                  ? "Add the drivers who run your own vehicles, then attach their CNIC and licence."
                  : "Nobody has been added to the fleet register yet."
              }
              action={
                canManage && (
                  <Button
                    size="sm"
                    className={ACTION_BTN}
                    onClick={openCreate}
                    iconBefore={<Plus className="h-4 w-4" />}
                  >
                    New driver
                  </Button>
                )
              }
              className="py-10"
            />
          </CardBody>
        </Card>
      ) : (
        <div className="w-full min-w-0">
          <div className="w-full overflow-x-auto">
            <Table className="w-full min-w-0 table-fixed" bordered dense>
              <THead>
                <TRow>
                  <TH style={{ ...HEAD_CELL, width: "26%" }}>Driver</TH>
                  <TH
                    className="hidden sm:table-cell"
                    style={{ ...HEAD_CELL, width: "14%" }}
                  >
                    Phone
                  </TH>
                  <TH
                    className="hidden md:table-cell"
                    style={{ ...HEAD_CELL, width: "20%" }}
                  >
                    CNIC
                  </TH>
                  <TH
                    className="hidden lg:table-cell"
                    style={{ ...HEAD_CELL, width: "15%" }}
                  >
                    Licence
                  </TH>
                  <TH style={{ ...HEAD_CELL, width: "11%" }}>Status</TH>
                  <TH style={{ ...HEAD_CELL, width: "14%", textAlign: "right" }}>
                    Actions
                  </TH>
                </TRow>
              </THead>

              <TBody>
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

                {!loading &&
                  rows.map((d) => (
                    <TRow
                      key={d.id}
                      className={`bg-card! ${d.isActive ? "" : "opacity-60"}`}
                    >
                      <TD style={{ ...CELL, ...CLIP }}>
                        <div className="truncate font-medium">{d.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {d.referenceNo}
                        </div>
                      </TD>

                      <TD
                        className="hidden sm:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        <span className="truncate text-xs">{d.phone || "—"}</span>
                      </TD>

                      <TD
                        className="hidden md:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        <span className="truncate font-mono text-xs">
                          {prettyCnic(d.cnic)}
                        </span>
                      </TD>

                      <TD
                        className="hidden lg:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        <span className="truncate text-xs">
                          {d.licenseNo || "—"}
                        </span>
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        <Badge
                          variant="soft"
                          size="sm"
                          text={d.isActive ? "Active" : "Inactive"}
                          className={`${CHIP} ${d.isActive ? SUCCESS_CHIP : NEUTRAL_CHIP}`}
                        />
                      </TD>

                      <TD style={{ ...CELL, ...CLIP, textAlign: "right" }}>
                        <div className="flex items-center justify-end gap-1">
                          <RowAction
                            title="Documents (CNIC, licence)"
                            onClick={() => setDocsFor(d)}
                          >
                            <Paperclip className="h-4 w-4" />
                          </RowAction>
                          {canManage && (
                            <RowAction title="Edit" onClick={() => openEdit(d)}>
                              <Pencil className="h-4 w-4" />
                            </RowAction>
                          )}
                          {canManage && d.isActive && (
                            <RowAction
                              title="Deactivate"
                              danger
                              disabled={busy}
                              onClick={() => remove(d)}
                            >
                              <Ban className="h-4 w-4" />
                            </RowAction>
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

      {/* Create / edit. Body scrolls, footer stays out of it — a dialog-level scroll
          puts the last field under the sticky footer and past the end of the range. */}
      {open && (
        <Modal
          isOpen
          onClose={() => !busy && setOpen(false)}
          disableOverlayClose={busy}
        >
          <ModalContent
            maxWidth="max-w-lg"
            className="flex max-h-[90vh] flex-col"
          >
            <form onSubmit={submit} className="flex min-h-0 flex-col">
              <ModalHeader
                title={editing ? "Edit driver" : "New driver"}
                icon={<IdCard className="h-4 w-4 text-primary" />}
                onClose={() => !busy && setOpen(false)}
              />

              <ModalBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
                <p className="text-sm text-muted-foreground">
                  Attach the CNIC and licence scans from the Docs button once
                  saved.
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    id="d-name"
                    label="Name"
                    value={form.name}
                    onChange={(e) => set({ name: e.target.value })}
                    placeholder="e.g. Muhammad Aslam"
                    disabled={busy}
                    required
                  />
                  <Input
                    id="d-phone"
                    type="tel"
                    label="Phone"
                    value={form.phone}
                    onChange={(e) => set({ phone: e.target.value })}
                    placeholder="03xx-xxxxxxx"
                    disabled={busy}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    id="d-cnic"
                    label="CNIC"
                    value={form.cnic}
                    onChange={(e) => set({ cnic: e.target.value })}
                    placeholder="42101-1234567-1"
                    disabled={busy}
                    helperText="Separators are optional, the server stores digits only."
                  />
                  <Input
                    id="d-license"
                    label="Licence number"
                    value={form.licenseNo}
                    onChange={(e) => set({ licenseNo: e.target.value })}
                    disabled={busy}
                  />
                </div>
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
                  iconBefore={
                    editing ? (
                      <Save className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )
                  }
                >
                  {editing ? "Save" : "Create"}
                </Button>
              </ModalFooter>
            </form>
          </ModalContent>
        </Modal>
      )}

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
