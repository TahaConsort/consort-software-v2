import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Target,
  FileSearch,
  FileText,
  Ship,
  ListChecks,
  DollarSign,
  AlertTriangle,
  CalendarClock,
  PhoneCall,
  RefreshCw,
} from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Skeleton,
  Stat,
} from "@neuctra/ui";
import { useDashboardStore } from "@/store/dashboardStore";
import { useAuthStore } from "@/store/authStore";
import { labelForRoles } from "@/lib/roles";
import {
  SHIPMENT_STATUS_LABELS,
  TASK_STATUS_LABELS,
  labelForService,
} from "@/lib/catalog";

/** One 36px baseline across the toolbar, as on the leads and queries screens. */
const ACTION_BTN = "h-9 px-3";
const CHIP = "shrink-0 whitespace-nowrap border text-xs";
const NEUTRAL_CHIP = "border-border bg-muted text-muted-foreground";

const sum = (obj) => Object.values(obj ?? {}).reduce((a, b) => a + b, 0);

/**
 * One KPI tile.
 *
 * `Stat` renders a div, so a tile that navigates gets wrapped in a real button rather
 * than handed an onClick: keyboard reach and the focus ring then come for free, and a
 * tile with nowhere to go stays plainly non-interactive instead of looking clickable.
 */
const KpiTile = ({ icon, label, value, hint, onClick, tone }) => {
  const stat = (
    <Stat
      label={label}
      value={value}
      description={hint}
      icon={icon}
      iconClassName={
        tone === "destructive"
          ? "bg-destructive/10 text-destructive"
          : undefined
      }
      className={`h-full ${onClick ? "transition-colors group-hover:border-primary/50" : ""}`}
    />
  );

  if (!onClick) return stat;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {stat}
    </button>
  );
};

/** Placeholder tiles carry the grid's shape while the first payload is in flight. */
const KpiSkeleton = ({ count = 4 }) => (
  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
    {Array.from({ length: count }, (_, i) => (
      <Skeleton key={i} variant="rectangular" height={116} />
    ))}
  </div>
);

const DashboardHome = () => {
  const { data, loading, error, fetchDashboard } = useDashboardStore();
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Dashboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {labelForRoles(user)} workspace
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className={ACTION_BTN}
          onClick={fetchDashboard}
          disabled={loading}
          iconBefore={
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          }
        >
          Refresh
        </Button>
      </div>

      {error && (
        <Callout type="error" title="Couldn't load your dashboard">
          {error}
        </Callout>
      )}

      {loading && <KpiSkeleton count={8} />}

      {!loading && data?.kind === "management" && (
        <ManagementView k={data.kpis} nav={navigate} />
      )}
      {!loading && data?.kind === "sales" && (
        <SalesView data={data} nav={navigate} />
      )}
      {!loading && data?.kind === "department" && (
        <DepartmentView data={data} nav={navigate} />
      )}
      {!loading && data?.kind === "customer" && (
        <CustomerView data={data} nav={navigate} />
      )}
    </div>
  );
};

const ManagementView = ({ k, nav }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiTile
        icon={<Users />}
        label="Employees"
        value={k.employees}
        onClick={() => nav("/admin/users")}
      />
      <KpiTile
        icon={<Users />}
        label="Customers"
        value={k.customers}
        onClick={() => nav("/admin/customers")}
      />
      <KpiTile
        icon={<Target />}
        label="Leads (open)"
        value={
          sum(k.leads) - (k.leads?.converted ?? 0) - (k.leads?.lost ?? 0)
        }
        hint={`${k.leads?.converted ?? 0} converted`}
        onClick={() => nav("/admin/leads")}
      />
      <KpiTile
        icon={<FileSearch />}
        label="Open queries"
        value={k.openQueries}
        onClick={() => nav("/admin/queries")}
      />
      <KpiTile
        icon={<FileText />}
        label="Live quotations"
        value={k.liveQuotations}
        onClick={() => nav("/admin/quotations")}
      />
      <KpiTile
        icon={<Ship />}
        label="Shipments"
        value={sum(k.shipments)}
        hint={`${k.shipments?.closed ?? 0} closed`}
        onClick={() => nav("/admin/shipments")}
      />
      <KpiTile
        icon={<ListChecks />}
        label="Open tasks"
        value={k.openTasks}
        onClick={() => nav("/admin/tasks")}
      />
      <KpiTile
        icon={<AlertTriangle />}
        label="Unroutable alerts"
        value={k.unroutableAlerts}
        tone="destructive"
        onClick={() => nav("/admin/notifications")}
      />
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      <KpiTile
        icon={<DollarSign />}
        label="Invoiced"
        value={k.revenue?.invoiced?.toLocaleString?.() ?? 0}
        hint="Issued and settled"
      />
      <KpiTile
        icon={<DollarSign />}
        label="Collected"
        value={k.revenue?.collected?.toLocaleString?.() ?? 0}
        hint="Payments received"
      />
    </div>
  </div>
);

const SalesView = ({ data, nav }) => {
  const k = data.kpis;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          icon={<Target />}
          label="My leads"
          value={sum(k.leads)}
          hint={`${k.leads?.qualified ?? 0} qualified`}
          onClick={() => nav("/admin/leads")}
        />
        <KpiTile
          icon={<FileSearch />}
          label="Open queries"
          value={k.openQueries}
          onClick={() => nav("/admin/queries")}
        />
        <KpiTile
          icon={<CalendarClock />}
          label="Upcoming visits"
          value={k.upcomingVisits}
          onClick={() => nav("/admin/visits")}
        />
        <KpiTile
          icon={<PhoneCall />}
          label="Follow-ups due"
          value={k.followUpsDue}
          onClick={() => nav("/admin/outreach")}
        />
        <KpiTile
          icon={<Ship />}
          label="My shipments"
          value={sum(k.shipments)}
          onClick={() => nav("/admin/shipments")}
        />
      </div>
      <RecentShipments rows={data.recentShipments} nav={nav} />
    </div>
  );
};

const DepartmentView = ({ data, nav }) => {
  const k = data.kpis;
  const tasks = data.recentTasks ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          icon={<Ship />}
          label="Active shipments"
          value={k.activeShipments}
          hint={`${data.department} department`}
          onClick={() => nav("/admin/shipments")}
        />
        <KpiTile
          icon={<ListChecks />}
          label="My tasks"
          value={k.myTasks}
          onClick={() => nav("/admin/tasks")}
        />
        <KpiTile
          icon={<ListChecks />}
          label="Queue"
          value={k.queuedTasks}
          hint="Unassigned, claimable"
          onClick={() => nav("/admin/tasks")}
        />
        <KpiTile
          icon={<AlertTriangle />}
          label="Overdue"
          value={k.overdueTasks}
          tone="destructive"
          onClick={() => nav("/admin/tasks")}
        />
      </div>

      <Card padding="none" className="overflow-hidden">
        <CardHeader
          title="Department queue"
          className="border-b border-border bg-accent px-5 py-3"
          titleClassName="text-base font-semibold"
        />
        <CardBody className="p-0">
          {tasks.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<ListChecks />}
              title="Queue is clear"
              description="Nothing is waiting on your department right now."
              className="py-10"
            />
          ) : (
            <ul className="divide-y divide-border">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {t.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {TASK_STATUS_LABELS[t.status]}
                      {t.dueDate
                        ? ` · due ${new Date(t.dueDate).toLocaleDateString()}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-3"
                    onClick={() => nav("/admin/tasks")}
                  >
                    Work
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

const CustomerView = ({ data, nav }) => {
  const k = data.kpis;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiTile
          icon={<Ship />}
          label="Active shipments"
          value={k.activeShipments}
          onClick={() => nav("/admin/shipments")}
        />
        <KpiTile
          icon={<FileSearch />}
          label="Queries"
          value={sum(k.queries)}
          onClick={() => nav("/admin/queries")}
        />
        <KpiTile
          icon={<DollarSign />}
          label="Open invoices"
          value={k.openInvoices}
        />
      </div>
      <RecentShipments rows={data.shipments} nav={nav} />
    </div>
  );
};

const RecentShipments = ({ rows, nav }) => {
  const list = rows ?? [];
  return (
    <Card padding="none" className="overflow-hidden">
      <CardHeader
        title="Recent shipments"
        className="border-b border-border bg-accent px-5 py-3"
        titleClassName="text-base font-semibold"
      />
      <CardBody className="p-0">
        {list.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Ship />}
            title="No shipments yet"
            description="Won quotations show up here once they become shipments."
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => nav(`/admin/shipments/${s.id}`)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-primary">
                      {s.referenceNo}
                    </p>
                    {/* Badges are flex items: without `shrink-0` they compress below
                        their own text and the label spills out of the pill. */}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(s.services ?? []).map((sv) => (
                        <Badge
                          key={sv}
                          variant="soft"
                          size="sm"
                          text={labelForService(sv)}
                          className={`${CHIP} ${NEUTRAL_CHIP}`}
                        />
                      ))}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    size="sm"
                    text={SHIPMENT_STATUS_LABELS[s.status] ?? s.status}
                    className={`${CHIP} ${NEUTRAL_CHIP}`}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
};

export default DashboardHome;
