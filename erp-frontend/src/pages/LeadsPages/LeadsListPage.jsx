import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Target, Search, RefreshCw, AlertCircle, TrendingUp, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLeadStore } from "@/store/leadStore";
import AddLeadModal from "./LeadComponents/AddLeadModal";
import {
  LeadStatusBadge,
  LeadSourceBadge,
  LEAD_STATUS_LABELS,
  LEAD_SOURCE_LABELS,
} from "./LeadComponents/leadBadges";

const SkeletonRow = () => (
  <tr className="border-t animate-pulse">
    {[...Array(6)].map((_, i) => (
      <td key={i} className="p-3"><div className="h-4 bg-muted rounded w-3/4" /></td>
    ))}
  </tr>
);

const StatCard = ({ label, value, icon: Icon, loading }) => (
  <div className="p-4 rounded-xl border shadow-sm">
    <div className="flex items-center justify-between mb-3">
      <span className="text-sm text-muted-foreground font-medium">{label}</span>
      <div className="p-2 rounded-lg bg-primary/10"><Icon className="w-4 h-4 text-primary" /></div>
    </div>
    {loading ? <div className="h-8 w-16 bg-muted rounded animate-pulse" /> : <h2 className="text-3xl font-bold">{value}</h2>}
  </div>
);

/**
 * LeadsListPage — the sales pipeline (CRM_MASTER §5.4).
 * Scope is server-side: a BDO sees own leads, an ASM their team, Management all.
 */
const LeadsListPage = () => {
  const { leads, loading, error, filters, setFilter, fetchLeads } = useLeadStore();
  const [search, setSearch] = useState("");

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const filtered = leads.filter(
    (l) =>
      l.referenceNo?.toLowerCase().includes(search.toLowerCase()) ||
      l.company?.name?.toLowerCase().includes(search.toLowerCase()) ||
      l.contact?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const openCount = leads.filter((l) => ["new", "contacted", "qualified"].includes(l.status)).length;
  const convertedCount = leads.filter((l) => l.status === "converted").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><Target className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Leads</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Pipeline from first outreach to customer</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchLeads} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <AddLeadModal onSuccess={fetchLeads} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Leads" value={leads.length} icon={Target} loading={loading} />
        <StatCard label="Open Pipeline" value={openCount} icon={TrendingUp} loading={loading} />
        <StatCard label="Converted" value={convertedCount} icon={UserCheck} loading={loading} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 border rounded-xl px-3 h-10 flex-1 min-w-[220px] bg-white dark:bg-zinc-900 shadow-sm focus-within:ring-2 focus-within:ring-primary/30 transition-all">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <Input
            placeholder="Search ref, company or contact…"
            className="border-0 shadow-none focus-visible:ring-0 h-full bg-transparent px-0"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select value={filters.status || "all"} onValueChange={(v) => setFilter("status", v === "all" ? "" : v)} items={[{ value: "all", label: "All statuses" }, ...Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}>
          <SelectTrigger className="w-36 h-10"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(LEAD_STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.source || "all"} onValueChange={(v) => setFilter("source", v === "all" ? "" : v)} items={[{ value: "all", label: "All sources" }, ...Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({ value, label }))]}>
          <SelectTrigger className="w-36 h-10"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {Object.entries(LEAD_SOURCE_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium flex-1">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchLeads} className="border-destructive/50 text-destructive hover:bg-destructive/10">Retry</Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-xl overflow-x-auto bg-white dark:bg-zinc-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left border-b">
            <tr>
              <th className="p-3 font-semibold text-muted-foreground">Ref</th>
              <th className="p-3 font-semibold text-muted-foreground">Company</th>
              <th className="p-3 font-semibold text-muted-foreground hidden md:table-cell">Contact</th>
              <th className="p-3 font-semibold text-muted-foreground hidden sm:table-cell">Source</th>
              <th className="p-3 font-semibold text-muted-foreground">Status</th>
              <th className="p-3 font-semibold text-muted-foreground hidden lg:table-cell">Owner</th>
            </tr>
          </thead>
          <tbody>
            {loading && <><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /></>}

            {!loading && filtered.map((lead) => (
              <tr key={lead.id} className="border-t hover:bg-muted/30 transition-colors">
                <td className="p-3">
                  <Link to={`/admin/leads/${lead.id}`} className="font-medium text-primary hover:underline">
                    {lead.referenceNo}
                  </Link>
                </td>
                <td className="p-3 font-medium">{lead.company?.name ?? "—"}</td>
                <td className="p-3 text-muted-foreground hidden md:table-cell">{lead.contact?.name ?? "—"}</td>
                <td className="p-3 hidden sm:table-cell"><LeadSourceBadge source={lead.source} /></td>
                <td className="p-3"><LeadStatusBadge status={lead.status} /></td>
                <td className="p-3 text-muted-foreground hidden lg:table-cell">{lead.ownerName}</td>
              </tr>
            ))}

            {!loading && filtered.length === 0 && !error && (
              <tr>
                <td colSpan="6" className="p-10 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Target className="w-8 h-8 opacity-30" />
                    <p className="font-medium">{search || filters.status || filters.source ? "No leads match" : "No leads yet — add your first"}</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default LeadsListPage;
