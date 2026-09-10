import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ship, RefreshCw, Pause, Ban, UserPlus, Eye } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  IconButton,
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
import { useShipmentStore } from "@/store/shipmentStore";
import { useAuthStore } from "@/store/authStore";
import {
  SHIPMENT_STATUS_LABELS,
  EXCEPTION_STATE_LABELS,
} from "@/lib/catalog";

/**
 * Row colours come from the semantic tokens, so the table follows the consumer's
 * light/dark theme with no `dark:` variants. Every chip shares one recipe — `/10`
 * fill, `/30` hairline, nowrap — so the columns read as one family.
 */
const CHIP = "whitespace-nowrap border text-xs";
const NEUTRAL_CHIP = "border-border bg-muted text-muted-foreground";

/**
 * There are ~25 shipment statuses and four status tokens, so they are grouped by what
 * the row means rather than given a colour each: finished, not started, everything in
 * between. Same grouping the page has always used.
 */
const statusTone = (s) =>
  ["settled", "closed"].includes(s)
    ? "border-success/30 bg-success/10 text-success"
    : s === "booking"
      ? NEUTRAL_CHIP
      : "border-info/30 bg-info/10 text-info";

/** One 36px baseline across the toolbar and the row actions, as on queries. */
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
 * than from its content, and only clips once overflow is hidden as well. Drop the
 * overflow and wide content wins the width negotiation, starving the narrow columns.
 */
const CLIP = { minWidth: 0, maxWidth: 0, overflow: "hidden" };

const OWNER_OPTIONS = [
  { value: "all", label: "All shipments" },
  { value: "me", label: "Mine" },
  { value: "none", label: "Unclaimed" },
];

const STATE_OPTIONS = [
  { value: "all", label: "All states" },
  { value: "none", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "cancelled", label: "Cancelled" },
];

/** Icon-only row action, so the column stays narrow enough for the data to breathe. */
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

const ShipmentsListPage = () => {
  const {
    shipments,
    loading,
    error,
    busy,
    filters,
    setFilter,
    fetchShipments,
    claim,
  } = useShipmentStore();
  const { hasPermission } = useAuthStore();
  const navigate = useNavigate();
  const [claiming, setClaiming] = useState(null);
  const canClaim = hasPermission("shipment.claim");

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  const onClaim = async (s) => {
    setClaiming(s.id);
    try {
      const res = await claim(s.id);
      toast.success(res?.message ?? `${s.referenceNo} is yours`);
    } catch (err) {
      toast.error(err?.message ?? "Could not claim this shipment");
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Ship className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Shipments
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Status follows the composed OTD path, so a shorter service set runs
              fewer steps
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={ACTION_BTN}
            onClick={fetchShipments}
            disabled={loading}
            iconBefore={
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            }
          >
            Refresh
          </Button>

          {canClaim && (
            <Select
              size="md"
              value={filters.owner || "all"}
              onValueChange={(v) => setFilter("owner", v === "all" ? "" : v)}
              options={OWNER_OPTIONS}
              placeholder="Owner"
              showCheckIcon={false}
              className="w-40!"
              containerClassName="w-40"
              triggerClassName="h-9"
            />
          )}

          <Select
            size="md"
            value={filters.exceptionState || "all"}
            onValueChange={(v) => setFilter("exceptionState", v === "all" ? "" : v)}
            options={STATE_OPTIONS}
            placeholder="State"
            showCheckIcon={false}
            className="w-36!"
            containerClassName="w-36"
            triggerClassName="h-9"
          />
        </div>
      </div>

      {error && (
        <Callout type="error" title="Couldn't load the shipments">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={fetchShipments}>
              Retry
            </Button>
          </div>
        </Callout>
      )}

      {/* EmptyState brings its own padding and icon sizing, so the Card only supplies
          the surface. The empty case replaces the table rather than living inside it:
          TD carries no `colSpan`, so a spanning "nothing here" row is not expressible. */}
      {!loading && shipments.length === 0 && !error ? (
        <Card padding="none">
          <EmptyState
            size="lg"
            icon={<Ship />}
            title="No shipments yet"
            description="A shipment is born the moment a quotation is approved, and appears here with its OTD path already composed."
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
                  <TH style={{ ...HEAD_CELL, width: "13%" }}>Ref</TH>
                  <TH style={{ ...HEAD_CELL, width: "20%" }}>Customer</TH>
              
                  <TH style={{ ...HEAD_CELL, width: "16%" }}>Status</TH>
                  <TH
                    className="hidden sm:table-cell"
                    style={{ ...HEAD_CELL, width: "12%" }}
                  >
                    State
                  </TH>
                  <TH
                    className="hidden lg:table-cell"
                    style={{ ...HEAD_CELL, width: "11%" }}
                  >
                    Owner
                  </TH>
                  <TH style={{ ...HEAD_CELL, width: "12%", textAlign: "right" }}>
                    Actions
                  </TH>
                </TRow>
              </THead>

              <TBody>
                {/* LOADING */}
                {loading &&
                  [...Array(4)].map((_, i) => (
                    <TRow key={i}>
                      {[...Array(7)].map((_, j) => (
                        <TD key={j} style={{ ...CELL, ...CLIP }}>
                          <Skeleton width="70%" height={16} />
                        </TD>
                      ))}
                    </TRow>
                  ))}

                {/* DATA */}
                {!loading &&
                  shipments.map((s) => (
                    <TRow
                      key={s.id}
                      className="bg-card! cursor-pointer"
                      onClick={() => navigate(`/admin/shipments/${s.id}`)}
                    >
                      <TD
                        style={{ ...CELL, ...CLIP }}
                        className="truncate font-medium text-primary"
                      >
                        {s.referenceNo}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        <div className="truncate font-medium">
                          {s.customerCompany}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {s.customerRef}
                        </div>
                      </TD>


                      <TD style={{ ...CELL, ...CLIP }}>
                        <Badge
                          variant="soft"
                          size="sm"
                          text={SHIPMENT_STATUS_LABELS[s.status] ?? s.status}
                          className={`${CHIP} ${statusTone(s.status)}`}
                        />
                      </TD>

                      <TD
                        className="hidden sm:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {s.exceptionState === "on_hold" && (
                          <Badge
                            variant="soft"
                            size="sm"
                            text="On Hold"
                            icon={<Pause className="h-3 w-3" />}
                            className={`${CHIP} border-warning/30 bg-warning/10 text-warning`}
                          />
                        )}
                        {s.exceptionState === "cancelled" && (
                          <Badge
                            variant="soft"
                            size="sm"
                            text="Cancelled"
                            icon={<Ban className="h-3 w-3" />}
                            className={`${CHIP} border-destructive/30 bg-destructive/10 text-destructive`}
                          />
                        )}
                        {s.exceptionState === "none" && (
                          <span className="text-xs text-muted-foreground">
                            {EXCEPTION_STATE_LABELS.none}
                          </span>
                        )}
                      </TD>

                      {/* Ops ownership — one person runs a shipment. Who that is is a
                          fact, so it stays a fact here; claiming is an action and lives
                          in the actions column with the others. */}
                      <TD
                        className="hidden truncate text-xs lg:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {s.opsOwnerName || (
                          <span className="text-muted-foreground">Unclaimed</span>
                        )}
                      </TD>

                      <TD style={{ ...CELL, ...CLIP, textAlign: "right" }}>
                        {/* The row itself navigates, so these must not bubble. */}
                        <div
                          className="flex min-w-0 items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <RowAction
                            title="Open shipment"
                            onClick={() => navigate(`/admin/shipments/${s.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </RowAction>

                          {!s.opsOwnerName && canClaim && (
                            <RowAction
                              title={
                                claiming === s.id
                                  ? "Claiming…"
                                  : "Claim this shipment"
                              }
                              disabled={busy || claiming === s.id}
                              onClick={() => onClaim(s)}
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
    </div>
  );
};

export default ShipmentsListPage;
