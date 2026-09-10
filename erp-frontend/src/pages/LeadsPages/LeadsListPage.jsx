import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Target,
  Search,
  RefreshCw,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Stat,
  TBody,
  TD,
  TH,
  THead,
  TRow,
  Table,
} from "@neuctra/ui";
import { useLeadStore } from "@/store/leadStore";
import AddLeadModal from "./LeadComponents/AddLeadModal";
import {
  LeadStatusBadge,
  LeadSourceBadge,
} from "./LeadComponents/leadBadges";
import {
  LEAD_STATUS_LABELS,
  LEAD_SOURCE_LABELS,
} from "./LeadComponents/leadLabels";

/** One 36px baseline across the toolbar, as on the queries screen. */
const ACTION_BTN = "h-9 px-3";

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

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

const SOURCE_OPTIONS = [
  { value: "all", label: "All sources" },
  ...Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

/**
 * LeadsListPage — the sales pipeline (CRM_MASTER §5.4).
 * Scope is server-side: a BDO sees own leads, an ASM their team, Management all.
 */
const LeadsListPage = () => {
  const { leads, loading, error, filters, setFilter, fetchLeads } =
    useLeadStore();
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? leads.filter((l) =>
        [l.referenceNo, l.company?.name, l.contact?.name]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q)),
      )
    : leads;

  const openCount = leads.filter((l) =>
    ["new", "contacted", "qualified"].includes(l.status),
  ).length;
  const convertedCount = leads.filter((l) => l.status === "converted").length;

  const filtersActive = !!(search || filters.status || filters.source);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Target className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Leads
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Pipeline from first outreach to customer
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={ACTION_BTN}
            onClick={fetchLeads}
            disabled={loading}
            iconBefore={
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            }
          >
            Refresh
          </Button>
          <AddLeadModal onSuccess={fetchLeads} />
        </div>
      </div>

      {/* Pipeline at a glance */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Total Leads"
          value={loading ? <Skeleton width={48} height={28} /> : leads.length}
          icon={<Target />}
        />
        <Stat
          label="Open Pipeline"
          value={loading ? <Skeleton width={48} height={28} /> : openCount}
          icon={<TrendingUp />}
          description="New, contacted or qualified"
        />
        <Stat
          label="Converted"
          value={loading ? <Skeleton width={48} height={28} /> : convertedCount}
          icon={<UserCheck />}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search ref, company or contact…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          prefixIcon={Search}
          wrapperClassName="min-w-56 flex-1"
        />
        <Select
          size="md"
          value={filters.status || "all"}
          onValueChange={(v) => setFilter("status", v === "all" ? "" : v)}
          options={STATUS_OPTIONS}
          placeholder="Status"
          showCheckIcon={false}
          className="w-40!"
          containerClassName="w-40"
          triggerClassName="h-9"
        />
        <Select
          size="md"
          value={filters.source || "all"}
          onValueChange={(v) => setFilter("source", v === "all" ? "" : v)}
          options={SOURCE_OPTIONS}
          placeholder="Source"
          showCheckIcon={false}
          className="w-40!"
          containerClassName="w-40"
          triggerClassName="h-9"
        />
      </div>

      {error && (
        <Callout type="error" title="Couldn't load the leads">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={fetchLeads}>
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
            icon={<Target />}
            title={filtersActive ? "No leads match" : "No leads yet"}
            description={
              filtersActive
                ? "Try a different search, or widen the status and source filters."
                : "Add your first lead to start the pipeline."
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
                  <TH style={{ ...HEAD_CELL, width: "16%" }}>Ref</TH>
                  <TH style={{ ...HEAD_CELL, width: "26%" }}>Company</TH>
                  <TH
                    className="hidden md:table-cell"
                    style={{ ...HEAD_CELL, width: "20%" }}
                  >
                    Contact
                  </TH>
                  <TH
                    className="hidden sm:table-cell"
                    style={{ ...HEAD_CELL, width: "12%" }}
                  >
                    Source
                  </TH>
                  <TH style={{ ...HEAD_CELL, width: "14%" }}>Status</TH>
                  <TH
                    className="hidden lg:table-cell"
                    style={{ ...HEAD_CELL, width: "12%" }}
                  >
                    Owner
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
                  filtered.map((lead) => (
                    <TRow key={lead.id} className="bg-card!">
                      <TD style={{ ...CELL, ...CLIP }}>
                        <Link
                          to={`/admin/leads/${lead.id}`}
                          className="block truncate font-medium text-primary hover:underline"
                        >
                          {lead.referenceNo}
                        </Link>
                      </TD>

                      <TD
                        className="truncate font-medium"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {lead.company?.name ?? "Not set"}
                      </TD>

                      <TD
                        className="hidden truncate text-muted-foreground md:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {lead.contact?.name ?? "Not set"}
                      </TD>

                      <TD
                        className="hidden sm:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        <LeadSourceBadge source={lead.source} />
                      </TD>

                      <TD style={{ ...CELL, ...CLIP }}>
                        <LeadStatusBadge status={lead.status} />
                      </TD>

                      <TD
                        className="hidden truncate text-muted-foreground lg:table-cell"
                        style={{ ...CELL, ...CLIP }}
                      >
                        {lead.ownerName}
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

export default LeadsListPage;
