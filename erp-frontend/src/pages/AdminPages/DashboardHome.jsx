import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Target, FileSearch, FileText, Ship, ListChecks,
  DollarSign, AlertTriangle, CalendarClock, PhoneCall, Loader2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDashboardStore } from "@/store/dashboardStore";
import { useAuthStore } from "@/store/authStore";
import { labelForRoles } from "@/lib/roles";
import { SHIPMENT_STATUS_LABELS, TASK_STATUS_LABELS, labelForService } from "@/lib/catalog";

const TONE = {
  primary: "bg-primary/10 text-primary",
  destructive: "bg-destructive/10 text-destructive",
};

const StatCard = ({ icon: Icon, label, value, hint, onClick, tone = "primary" }) => (
  <button onClick={onClick} disabled={!onClick}
    className={`text-left border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-4 transition-colors ${onClick ? "hover:border-primary/50 cursor-pointer" : "cursor-default"}`}>
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`p-1.5 rounded-lg ${TONE[tone] ?? TONE.primary}`}><Icon className="w-4 h-4" /></span>
    </div>
    <p className="text-2xl font-semibold mt-2">{value}</p>
    {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
  </button>
);

const sum = (obj) => Object.values(obj ?? {}).reduce((a, b) => a + b, 0);

const DashboardHome = () => {
  const { data, loading, error, fetchDashboard } = useDashboardStore();
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><LayoutDashboard className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{labelForRoles(user)} workspace</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchDashboard} disabled={loading} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {loading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>}
      {error && <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive text-sm">{error}</div>}

      {!loading && data?.kind === "management" && <ManagementView k={data.kpis} nav={navigate} />}
      {!loading && data?.kind === "sales" && <SalesView data={data} nav={navigate} />}
      {!loading && data?.kind === "department" && <DepartmentView data={data} nav={navigate} />}
      {!loading && data?.kind === "customer" && <CustomerView data={data} nav={navigate} />}
    </div>
  );
};

const ManagementView = ({ k, nav }) => (
  <>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard icon={Users} label="Employees" value={k.employees} onClick={() => nav("/admin/users")} />
      <StatCard icon={Users} label="Customers" value={k.customers} onClick={() => nav("/admin/customers")} />
      <StatCard icon={Target} label="Leads (open)" value={sum(k.leads) - (k.leads?.converted ?? 0) - (k.leads?.lost ?? 0)} hint={`${k.leads?.converted ?? 0} converted`} onClick={() => nav("/admin/leads")} />
      <StatCard icon={FileSearch} label="Open queries" value={k.openQueries} onClick={() => nav("/admin/queries")} />
      <StatCard icon={FileText} label="Live quotations" value={k.liveQuotations} onClick={() => nav("/admin/quotations")} />
      <StatCard icon={Ship} label="Shipments" value={sum(k.shipments)} hint={`${k.shipments?.closed ?? 0} closed`} onClick={() => nav("/admin/shipments")} />
      <StatCard icon={ListChecks} label="Open tasks" value={k.openTasks} onClick={() => nav("/admin/tasks")} />
      <StatCard icon={AlertTriangle} label="Unroutable alerts" value={k.unroutableAlerts} tone="destructive" onClick={() => nav("/admin/notifications")} />
    </div>
    <div className="grid sm:grid-cols-2 gap-4">
      <StatCard icon={DollarSign} label="Invoiced" value={k.revenue?.invoiced?.toLocaleString?.() ?? 0} hint="Issued + settled" />
      <StatCard icon={DollarSign} label="Collected" value={k.revenue?.collected?.toLocaleString?.() ?? 0} hint="Payments received" />
    </div>
  </>
);

const SalesView = ({ data, nav }) => {
  const k = data.kpis;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Target} label="My leads" value={sum(k.leads)} hint={`${k.leads?.qualified ?? 0} qualified`} onClick={() => nav("/admin/leads")} />
        <StatCard icon={FileSearch} label="Open queries" value={k.openQueries} onClick={() => nav("/admin/queries")} />
        <StatCard icon={CalendarClock} label="Upcoming visits" value={k.upcomingVisits} onClick={() => nav("/admin/visits")} />
        <StatCard icon={PhoneCall} label="Follow-ups due" value={k.followUpsDue} onClick={() => nav("/admin/outreach")} />
        <StatCard icon={Ship} label="My shipments" value={sum(k.shipments)} onClick={() => nav("/admin/shipments")} />
      </div>
      <RecentShipments rows={data.recentShipments} nav={nav} />
    </>
  );
};

const DepartmentView = ({ data, nav }) => {
  const k = data.kpis;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Ship} label="Active shipments" value={k.activeShipments} hint={`${data.department} department`} onClick={() => nav("/admin/shipments")} />
        <StatCard icon={ListChecks} label="My tasks" value={k.myTasks} onClick={() => nav("/admin/tasks")} />
        <StatCard icon={ListChecks} label="Queue" value={k.queuedTasks} hint="Unassigned — claimable" onClick={() => nav("/admin/tasks")} />
        <StatCard icon={AlertTriangle} label="Overdue" value={k.overdueTasks} tone="destructive" onClick={() => nav("/admin/tasks")} />
      </div>
      <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5">
        <h2 className="font-semibold mb-3">Department queue</h2>
        {(data.recentTasks ?? []).length === 0 && <p className="text-sm text-muted-foreground">Queue is clear.</p>}
        <ul className="divide-y">
          {(data.recentTasks ?? []).map((t) => (
            <li key={t.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{t.title}</p>
                <p className="text-xs text-muted-foreground">{TASK_STATUS_LABELS[t.status]}{t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString()}` : ""}</p>
              </div>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => nav("/admin/tasks")}>Work</Button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
};

const CustomerView = ({ data, nav }) => {
  const k = data.kpis;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Ship} label="Active shipments" value={k.activeShipments} onClick={() => nav("/admin/shipments")} />
        <StatCard icon={FileSearch} label="Queries" value={sum(k.queries)} onClick={() => nav("/admin/queries")} />
        <StatCard icon={DollarSign} label="Open invoices" value={k.openInvoices} />
      </div>
      <RecentShipments rows={data.shipments} nav={nav} />
    </>
  );
};

const RecentShipments = ({ rows, nav }) => (
  <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5">
    <h2 className="font-semibold mb-3">Recent shipments</h2>
    {(rows ?? []).length === 0 && <p className="text-sm text-muted-foreground">No shipments yet.</p>}
    <ul className="divide-y">
      {(rows ?? []).map((s) => (
        <li key={s.id} className="py-2.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-muted/30 -mx-2 px-2 rounded" onClick={() => nav(`/admin/shipments/${s.id}`)}>
          <div className="min-w-0">
            <p className="text-sm font-medium text-primary">{s.referenceNo}</p>
            <div className="flex flex-wrap gap-1 mt-0.5">{(s.services ?? []).map((sv) => <Badge key={sv} variant="secondary" className="text-[10px]">{labelForService(sv)}</Badge>)}</div>
          </div>
          <Badge variant="outline" className="text-xs">{SHIPMENT_STATUS_LABELS[s.status]}</Badge>
        </li>
      ))}
    </ul>
  </div>
);

export default DashboardHome;
