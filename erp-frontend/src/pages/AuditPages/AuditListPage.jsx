import { useEffect, useState } from "react";
import { ShieldCheck, Loader2, ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuditStore } from "@/store/auditStore";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");
const ANY = "__any__";

/**
 * Audit trail (CRM_MASTER §5.19). Management-only. Filter by resource type,
 * action and date; expand a row to see the field-level diff (INV-15).
 */
const AuditListPage = () => {
  const { logs, meta, facets, filters, loading, error, setFilter, fetch, fetchFacets } = useAuditStore();
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { fetchFacets(); fetch(1); }, [fetchFacets, fetch]);

  const apply = () => fetch(1);
  const clear = () => {
    ["resourceType", "action", "actorId", "from", "to"].forEach((k) => setFilter(k, ""));
    setTimeout(() => fetch(1), 0);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><ShieldCheck className="w-5 h-5" /></div>
        <div>
          <h1 className="text-xl font-semibold leading-none">Audit Trail</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Every mutation, with actor and field-level diff (INV-15).</p>
        </div>
      </div>

      {/* Filters */}
      <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Resource</label>
          <Select value={filters.resourceType || ANY} onValueChange={(v) => setFilter("resourceType", v === ANY ? "" : v)} items={[{ value: ANY, label: "Any resource" }, ...facets.resourceTypes.map((t) => ({ value: t, label: t }))]}>
            <SelectTrigger className="h-9 w-40 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any resource</SelectItem>
              {facets.resourceTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Action</label>
          <Select value={filters.action || ANY} onValueChange={(v) => setFilter("action", v === ANY ? "" : v)} items={[{ value: ANY, label: "Any action" }, ...facets.actions.map((a) => ({ value: a, label: a }))]}>
            <SelectTrigger className="h-9 w-48 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any action</SelectItem>
              {facets.actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">From</label>
          <Input type="date" className="h-9 w-36 text-xs" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">To</label>
          <Input type="date" className="h-9 w-36 text-xs" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
        </div>
        <Button size="sm" className="h-9 gap-1.5" onClick={apply}><Filter className="w-3.5 h-3.5" /> Apply</Button>
        <Button size="sm" variant="ghost" className="h-9 gap-1.5" onClick={clear}><X className="w-3.5 h-3.5" /> Clear</Button>
      </div>

      {error && <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm">{error}</div>}
      {loading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>}

      {!loading && (
        <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm divide-y">
          {logs.length === 0 && <div className="p-10 text-center text-muted-foreground text-sm">No audit entries.</div>}
          {logs.map((l) => (
            <div key={l.id}>
              <button onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition">
                <Badge variant="secondary" className="text-[10px] font-mono">{l.action}</Badge>
                <span className="text-sm min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">{l.resourceType}</span> · {l.actor?.name || l.actor?.email || "system"}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">{fmt(l.createdAt)}</span>
              </button>
              {expanded === l.id && (
                <div className="px-4 pb-3 -mt-1">
                  <div className="text-xs text-muted-foreground mb-1">
                    resourceId <span className="font-mono">{l.resourceId}</span>
                    {l.correlationId && <> · correlation <span className="font-mono">{l.correlationId}</span></>}
                  </div>
                  {l.diff && (
                    <pre className="text-xs bg-muted rounded-lg p-3 overflow-x-auto">{JSON.stringify(l.diff, null, 2)}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Paging */}
      {meta.pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="outline" disabled={meta.page <= 1} onClick={() => fetch(meta.page - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm text-muted-foreground">Page {meta.page} of {meta.pages} · {meta.total} entries</span>
          <Button size="sm" variant="outline" disabled={meta.page >= meta.pages} onClick={() => fetch(meta.page + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}
    </div>
  );
};

export default AuditListPage;
