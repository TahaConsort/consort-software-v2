import { useEffect, useMemo } from "react";
import { BarChart3, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { useReportStore } from "@/store/reportStore";
import { REPORTS } from "@/services/reportService";
import { isManagement, hasAnyRole } from "@/lib/roles";

const pretty = (s) => String(s).replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const isNum = (v) => typeof v === "number";
const fmtVal = (v) => (isNum(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v ?? "—"));

/**
 * Reports (CRM_MASTER §5.18). Role-scoped aggregations with CSV export. The role
 * determines which reports appear — revenue is Finance/Management only.
 */
const ReportsListPage = () => {
  const user = useAuthStore((s) => s.user);
  const { activeKey, rows, summary, loading, error, fetch, download } = useReportStore();

  const tabs = useMemo(
    () => REPORTS.filter((r) => !r.revenueOnly || isManagement(user) || hasAnyRole(user, ["accounts"])),
    [user],
  );

  useEffect(() => { fetch(activeKey); }, [activeKey, fetch]);

  const columns = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><BarChart3 className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-semibold leading-none">Reports</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Scoped to your role · export to CSV</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-2" disabled={loading || rows.length === 0} onClick={() => download(activeKey)}>
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => fetch(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition ${activeKey === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm">{error}</div>}
      {loading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>}

      {!loading && !error && (
        <>
          {/* Summary cards */}
          {summary && (
            <div className="flex flex-wrap gap-3">
              {Object.entries(summary)
                .filter(([, v]) => isNum(v) || typeof v === "string")
                .map(([k, v]) => (
                  <div key={k} className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm px-4 py-3 min-w-[120px]">
                    <p className="text-xs text-muted-foreground">{pretty(k)}</p>
                    <p className="text-lg font-semibold mt-0.5">{fmtVal(v)}</p>
                  </div>
                ))}
            </div>
          )}

          {/* Nested summary breakdowns (arrays / objects) */}
          {summary && Object.entries(summary).filter(([, v]) => Array.isArray(v) || (v && typeof v === "object")).map(([k, v]) => (
            <div key={k} className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-4">
              <p className="text-sm font-medium mb-2">{pretty(k)}</p>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(v) ? v : Object.entries(v).map(([kk, vv]) => ({ label: kk, count: vv }))).map((item, i) => {
                  const label = item.label ?? item.type ?? item.status ?? item.reason ?? item.outcome ?? item.stepCode ?? Object.values(item)[0];
                  const val = item.count ?? item.avgHoursFromStart ?? Object.values(item)[1];
                  return <span key={i} className="text-xs bg-muted rounded-md px-2 py-1">{pretty(label)}: <b>{fmtVal(val)}</b></span>;
                })}
              </div>
            </div>
          ))}

          {/* Main table */}
          <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm overflow-x-auto">
            {rows.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">No data for this report.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {columns.map((c) => <th key={c} className="px-4 py-2 font-medium">{pretty(c)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                      {columns.map((c) => <td key={c} className="px-4 py-2">{fmtVal(r[c])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ReportsListPage;
