import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ListChecks, RefreshCw, AlertCircle, CheckCircle2, Hand, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { useTaskStore } from "@/store/taskStore";
import { useAuthStore } from "@/store/authStore";
import * as taskService from "@/services/taskService";
import { TASK_STATUS_LABELS } from "@/lib/catalog";

const STATUS_STYLE = {
  queued: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300",
  open: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-300",
  in_progress: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300",
  done: "bg-green-50 text-green-700 border-green-400 dark:bg-green-950/30 dark:text-green-300",
  on_hold: "bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-300",
  cancelled: "bg-zinc-100 text-zinc-500 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400",
};

const overdue = (t) => t.dueDate && new Date(t.dueDate) < new Date() && ["open", "in_progress"].includes(t.status);

const compact = (n) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

const TasksListPage = () => {
  const { tasks, loading, error, statusFilter, setStatusFilter, fetchTasks } = useTaskStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
      fetchTasks();
    } catch (err) {
      toast.error(err?.message || "Couldn't update the task");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><ListChecks className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">My Task Queue</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Completing a step's task advances the shipment (RULE-TK-02)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)} items={[{ value: "all", label: "All statuses" }, ...Object.entries(TASK_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(TASK_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchTasks} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertCircle className="w-5 h-5 shrink-0" /><p className="text-sm font-medium flex-1">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchTasks}>Retry</Button>
        </div>
      )}

      <div className="grid gap-3">
        {loading && [...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl border bg-muted/30 animate-pulse" />)}

        {!loading && tasks.map((t) => (
          <div key={t.id} className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">{t.title}</p>
                <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[t.status] ?? ""}`}>{TASK_STATUS_LABELS[t.status]}</Badge>
                {overdue(t) && <Badge variant="outline" className="text-[10px] gap-1 bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300"><Clock className="w-3 h-3" /> Overdue</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t.departmentName}{t.shipmentRef ? ` · ${t.shipmentRef}` : ""}{t.assigneeName ? ` · ${t.assigneeName}` : " · unassigned (queue)"}
                {t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString()}` : ""}
              </p>
              {t.stepMoney && ((t.stepMoney.receivable?.count ?? 0) > 0 || (t.stepMoney.payable?.count ?? 0) > 0) && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  {(t.stepMoney.receivable?.count ?? 0) > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300">
                      IN {compact(t.stepMoney.receivable.total)}
                    </Badge>
                  )}
                  {(t.stepMoney.payable?.count ?? 0) > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-300">
                      OUT {compact(t.stepMoney.payable.total)}
                    </Badge>
                  )}
                </div>
              )}
              {t.description && <p className="text-sm text-muted-foreground mt-1">{t.description}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {t.shipmentId && (
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => navigate(`/admin/shipments/${t.shipmentId}`)}>Open</Button>
              )}
              {!t.assigneeId && ["queued", "open"].includes(t.status) && hasPermission("task.update") && (
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => act(() => taskService.claimTask(t.id), "Task claimed")}>
                  <Hand className="w-3.5 h-3.5" /> Claim
                </Button>
              )}
              {["open", "in_progress"].includes(t.status) && hasPermission("task.complete") && (
                <Button size="sm" className="h-8 text-xs gap-1" onClick={() => act(() => taskService.completeTask(t.id), "Task completed")}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Complete
                </Button>
              )}
            </div>
          </div>
        ))}

        {!loading && tasks.length === 0 && !error && (
          <div className="p-10 text-center border rounded-xl">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <ListChecks className="w-8 h-8 opacity-30" /><p className="font-medium">Your queue is clear</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TasksListPage;
