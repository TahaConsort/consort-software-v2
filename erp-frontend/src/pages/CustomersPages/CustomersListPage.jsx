import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Handshake,
  Search,
  RefreshCw,
  Globe,
  Copy,
  UserPlus,
  FileSearch,
} from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Card,
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
import toast from "react-hot-toast";
import { useCustomerStore } from "@/store/customerStore";
import { useAuthStore } from "@/store/authStore";
import { isManagement, hasAnyRole } from "@/lib/roles";
import { LeadSourceBadge } from "../LeadsPages/LeadComponents/leadBadges";
import { CHIP, NEUTRAL_CHIP } from "../LeadsPages/LeadComponents/leadLabels";

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

/** Icon-only row action, so two controls fit the column without wrapping. */
const RowAction = ({ title, onClick, disabled, children }) => (
  <Tooltip content={title}>
    <span className="inline-flex shrink-0">
      <IconButton
        variant="ghost"
        className={`${ACTION_ICON_BTN} text-muted-foreground hover:text-foreground`}
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
        icon={children}
      />
    </span>
  </Tooltip>
);

/**
 * CustomersListPage — customers exist only via lead conversion (RULE-LD-05).
 * Portal-user provisioning (WORKFLOW §1) is Management + ASM.
 */
const CustomersListPage = () => {
  const { customers, loading, error, fetchCustomers } = useCustomerStore();
  const currentUser = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  // An id, not the row object: the modal stays open after success to show the activation
  // link, and a background refresh replaces the array underneath it. Resolving from the
  // live list keeps what it renders current (the pattern FinanceListPage already uses).
  const [portalForId, setPortalForId] = useState(null);
  const portalFor = customers.find((c) => c.id === portalForId) ?? null;

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const canProvision =
    isManagement(currentUser) || hasAnyRole(currentUser, ["asm"]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? customers.filter((c) =>
        [c.referenceNo, c.companyName]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q)),
      )
    : customers;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Handshake className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Customers
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Converted from qualified leads, one per company
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className={ACTION_BTN}
          onClick={fetchCustomers}
          disabled={loading}
          iconBefore={
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          }
        >
          Refresh
        </Button>
      </div>

      <Input
        placeholder="Search by CST ref or company…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        prefixIcon={Search}
        wrapperClassName="w-full"
      />

      {error && (
        <Callout type="error" title="Couldn't load the customers">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={fetchCustomers}>
              Retry
            </Button>
          </div>
        </Callout>
      )}

      {/* EmptyState brings its own padding and icon sizing, so the Card only supplies
          the surface. The empty case replaces the table rather than living inside it:
          TD carries no `colSpan`, so a spanning "nothing here" row is not expressible. */}
      {!loading && filtered.length === 0 && !error ? (
        <Card padding="none">
          <EmptyState
            size="lg"
            icon={<Handshake />}
            title={search ? "No customers match" : "No customers yet"}
            description={
              search
                ? "Try a different reference or company name."
                : "A customer appears here the moment a qualified lead is converted."
            }
          />
        </Card>
      ) : (
        /* Table renders its own surface, plus overflow-x-auto from `responsive`.
           Wrapping it in a Card would nest a second border at a smaller radius. */
        <div className="w-full min-w-0">
          <div className="w-full overflow-x-auto">
            <Table className="w-full min-w-0 table-fixed" bordered dense>
              <THead>
                <TRow>
                  <TH style={{ ...HEAD_CELL, width: "15%" }}>Ref</TH>
                  <TH style={{ ...HEAD_CELL, width: "28%" }}>Company</TH>
                  <TH
                    className="hidden sm:table-cell"
                    style={{ ...HEAD_CELL, width: "12%" }}
                  >
                    Source
                  </TH>
                  <TH
                    className="hidden md:table-cell"
                    style={{ ...HEAD_CELL, width: "18%" }}
                  >
                    Assigned BDO
                  </TH>
                  <TH style={{ ...HEAD_CELL, width: "12%" }}>Portal</TH>
                  <TH style={{ ...HEAD_CELL, width: "15%", textAlign: "right" }}>
                    Actions
                  </TH>
                </TRow>
              </THead>

              <TBody>
                {/* LOADING */}
                {loading &&
                  [...Array(4)].map((_, i) => (
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
                  filtered.map((c) => (
                    <TRow key={c.id} className="bg-card!">
                      <TD
                        className="truncate font-medium text-primary"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {c.referenceNo}
                      </TD>

                      <TD
                        className="truncate font-medium"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {c.companyName}
                      </TD>

                      <TD
                        className="hidden sm:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        <LeadSourceBadge source={c.source} />
                      </TD>

                      <TD
                        className="hidden truncate text-muted-foreground md:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {c.assignedBdoName ?? "Unassigned"}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        {c.portalUsers?.length ? (
                          <Badge
                            variant="soft"
                            size="sm"
                            text={String(c.portalUsers.length)}
                            icon={<Globe className="h-3 w-3" />}
                            className={`${CHIP} border-success/30 bg-success/10 text-success`}
                          />
                        ) : (
                          <Badge
                            variant="soft"
                            size="sm"
                            text="None"
                            className={`${CHIP} ${NEUTRAL_CHIP}`}
                          />
                        )}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP, textAlign: "right" }}>
                        <div className="flex min-w-0 items-center justify-end gap-1.5">
                          {hasPermission("query.create") && c.isActive && (
                            <RowAction
                              title="Raise a query for this customer"
                              onClick={() =>
                                navigate("/admin/queries", {
                                  state: { customerId: c.id },
                                })
                              }
                            >
                              <FileSearch className="h-4 w-4" />
                            </RowAction>
                          )}
                          {canProvision && c.isActive && (
                            <RowAction
                              title="Provision a portal user"
                              onClick={() => setPortalForId(c.id)}
                            >
                              <UserPlus className="h-4 w-4" />
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

      {portalFor && (
        <PortalUserModal
          customer={portalFor}
          onClose={() => setPortalForId(null)}
        />
      )}
    </div>
  );
};

/* ── Provision portal user (WORKFLOW §1 "provision portal user") ── */
const PortalUserModal = ({ customer, onClose }) => {
  // Through the store: creating a portal user also creates a User row, so the employee
  // list changes too, and the store publishes both topics.
  const createPortalUser = useCustomerStore((s) => s.createPortalUser);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);

  const reset = () => {
    setEmail("");
    setLink(null);
    onClose();
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await createPortalUser(customer.id, email);
      toast.success("Portal user created");
      if (res.devActivationToken) {
        setLink(
          `${window.location.origin}/activate?token=${res.devActivationToken}`,
        );
      } else {
        reset();
      }
      // No onSuccess callback needed: the store refetched the customer list and published
      // `customers`/`employees` before this line ran.
    } catch (err) {
      toast.error(err?.message || "Failed to create portal user");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={() => !busy && reset()} disableOverlayClose={busy}>
      <ModalContent maxWidth="max-w-md">
        <ModalHeader
          title="Provision Portal User"
          onClose={() => !busy && reset()}
        />

        {link ? (
          <>
            <ModalBody className="space-y-3">
              <Callout type="success" title="The login is ready">
                Share this activation link with {customer.companyName}. They set
                their own password from it.
              </Callout>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={link}
                  wrapperClassName="min-w-0 flex-1"
                />
                <Tooltip content="Copy the link">
                  <span className="inline-flex shrink-0">
                    <IconButton
                      variant="outline"
                      aria-label="Copy the activation link"
                      icon={<Copy className="h-4 w-4" />}
                      onClick={() => {
                        navigator.clipboard?.writeText(link);
                        toast.success("Copied");
                      }}
                    />
                  </span>
                </Tooltip>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button onClick={reset}>Done</Button>
            </ModalFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <ModalBody className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Creates a portal login for{" "}
                <b className="text-foreground">{customer.companyName}</b>. They
                set their password via the activation link and see only their own
                shipments.
              </p>
              <Input
                id="portal-email"
                type="email"
                label="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@company.com"
                required
                disabled={busy}
              />
            </ModalBody>
            <ModalFooter>
              <Button
                type="button"
                variant="outline"
                onClick={reset}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy}
                loading={busy}
                loadingText="Creating…"
                iconBefore={<UserPlus className="h-4 w-4" />}
              >
                Create
              </Button>
            </ModalFooter>
          </form>
        )}
      </ModalContent>
    </Modal>
  );
};

export default CustomersListPage;
