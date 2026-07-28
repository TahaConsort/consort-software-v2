import { useEffect, useState } from "react";
import { Cpu, Loader2, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActionEngineStore } from "@/store/actionEngineStore";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");

/**
 * Action Engine (CRM_MASTER §5.12). Management-only window into what the engine
 * does: the task-template catalog, the outbox event flow (ADR-021), and the
 * unroutable escalations that must never be silently dropped (RULE-AE-05).
 */
const TABS = [
  { key: "templates", label: "Templates" },
  { key: "outbox", label: "Event flow" },
  { key: "unroutable", label: "Unroutable" },
];

const ActionEngineListPage = () => {
  const [tab, setTab] = useState("templates");
  const {
    templates, outbox, outboxMeta, unroutable, unroutableMeta, loading, error,
    fetchTemplates, fetchOutbox, fetchUnroutable,
  } = useActionEngineStore();

  useEffect(() => {
    if (tab === "templates") fetchTemplates();
    if (tab === "outbox") fetchOutbox();
    if (tab === "unroutable") fetchUnroutable();
  }, [tab, fetchTemplates, fetchOutbox, fetchUnroutable]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><Cpu className="w-5 h-5" /></div>
        <div>
          <h1 className="text-xl font-semibold leading-none">Action Engine</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Events drive tasks (ADR-020); unroutable work escalates here (RULE-AE-05).</p>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
            {t.key === "unroutable" && unroutableMeta.open > 0 && <span className="ml-2 text-[10px] bg-destructive text-white rounded-full px-1.5 py-0.5">{unroutableMeta.open}</span>}
          </button>
        ))}
      </div>

      {error && <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm">{error}</div>}
      {loading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>}

      {!loading && tab === "templates" && (
        <div className="grid gap-2">
          {templates.length === 0 && <Empty text="No task templates seeded yet — run node prisma/seed.js." />}
          {templates.map((t) => (
            <div key={t.id} className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{t.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <span className="font-mono">{t.eventCode}</span>{t.stepCode ? ` · step ${t.stepCode}` : ""} → {t.department} · due +{t.dueOffsetHours}h
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {(t.requiredDocTypes ?? []).map((d) => <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>)}
                  <Badge variant="outline" className={`text-[10px] ${t.isActive ? "border-green-400 text-green-700 dark:text-green-300" : "text-muted-foreground"}`}>{t.isActive ? "active" : "inactive"}</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "outbox" && (
        <div className="space-y-3">
          <div className="flex gap-3 text-sm">
            <Stat icon={<Clock className="w-4 h-4" />} label="Pending" value={outboxMeta.pending} tone={outboxMeta.pending > 0 ? "amber" : "green"} />
            <Stat icon={<AlertTriangle className="w-4 h-4" />} label="Stuck (>3 tries)" value={outboxMeta.stuck} tone={outboxMeta.stuck > 0 ? "red" : "green"} />
          </div>
          <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm divide-y">
            {outbox.length === 0 && <Empty text="No events yet." />}
            {outbox.map((e) => (
              <div key={e.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-mono text-xs">{e.eventType}</span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{fmt(e.createdAt)}{e.attempts ? ` · ${e.attempts} attempt(s)` : ""}{e.lastError ? ` · ${e.lastError}` : ""}</p>
                </div>
                {e.dispatchedAt
                  ? <Badge variant="outline" className="text-[10px] border-green-400 text-green-700 dark:text-green-300 gap-1"><CheckCircle2 className="w-3 h-3" /> dispatched</Badge>
                  : <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-300 gap-1"><Clock className="w-3 h-3" /> pending</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && tab === "unroutable" && (
        <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm divide-y">
          {unroutable.length === 0 && <Empty text="No unroutable actions — every event found an assignee." />}
          {unroutable.map((n) => (
            <div key={n.id} className={`px-4 py-3 flex items-start gap-3 ${!n.readAt ? "bg-destructive/5" : ""}`}>
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                <p className="text-[11px] text-muted-foreground mt-0.5">{fmt(n.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Empty = ({ text }) => <div className="p-10 text-center text-muted-foreground text-sm">{text}</div>;

const TONE = {
  green: "border-green-300 text-green-700 dark:text-green-300",
  amber: "border-amber-300 text-amber-700 dark:text-amber-300",
  red: "border-red-300 text-red-700 dark:text-red-300",
};
const Stat = ({ icon, label, value, tone }) => (
  <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${TONE[tone]}`}>
    {icon}<span className="text-xs">{label}:</span><span className="font-semibold">{value}</span>
  </div>
);

export default ActionEngineListPage;
