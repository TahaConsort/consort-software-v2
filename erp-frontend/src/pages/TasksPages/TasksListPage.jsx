import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ListChecks,
  RefreshCw,
  CheckCircle2,
  Hand,
  Clock,
  ArrowRight,
} from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  EmptyState,
  Select,
  Skeleton,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import { useTaskStore } from "@/store/taskStore";
import { useAuthStore } from "@/store/authStore";
import { TASK_STATUS_LABELS } from "@/lib/catalog";

/** One 36px baseline across the toolbar, as on the leads and queries screens. */
const ACTION_BTN = "h-9 px-3";

/**
 * One chip recipe for every badge on this screen — a /10 fill, a /30 hairline, nowrap —
 * so the row reads as a single family. All of it comes off the semantic tokens, which is
 * why there are no `dark:` variants: the ramp follows the theme on its own.
 */
const CHIP = "shrink-0 whitespace-nowrap border text-xs";
const TONE = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-info/30 bg-info/10 text-info",
  warning: "border-warning/30 bg-warning/10 text-warning",
  success: "border-success/30 bg-success/10 text-success",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

const STATUS_TONE = {
  queued: TONE.neutral,
  open: TONE.info,
  in_progress: TONE.warning,
  done: TONE.success,
  on_hold: TONE.warning,
  cancelled: `${TONE.neutral} line-through`,
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...Object.entries(TASK_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

const compact = (n) =>
  Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;

const TasksListPage = () => {
  const {
    tasks,
    loading,
    error,
    busy,
    filters,
    setFilter,
    fetchTasks,
    claimTask,
    completeTask,
  } = useTaskStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();

  /**
   * A due date passes on its own, with nobody typing. Reading the clock from ticking
   * state rather than calling `new Date()` mid-render means the Overdue chip actually
   * appears when the deadline goes by, instead of at whatever re-render happens next —
   * and it keeps an impure call out of the render path.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const isOverdue = (t) =>
    t.dueDate &&
    new Date(t.dueDate).getTime() < now &&
    ["open", "in_progress"].includes(t.status);

  // The store refetches and publishes: completing a step-linked task advances the
  // shipment (RULE-TK-02), so the shipment screens and the dashboard hear about it too.
  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg || res?.message);
    } catch (err) {
      toast.error(err?.message || "Couldn't update the task");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              My Task Queue
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Completing a step's task advances the shipment (RULE-TK-02)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
          <Button
            variant="ghost"
            size="sm"
            className={ACTION_BTN}
            onClick={fetchTasks}
            disabled={loading}
            iconBefore={
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            }
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Callout type="error" title="Couldn't load your tasks">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={fetchTasks}>
              Retry
            </Button>
          </div>
        </Callout>
      )}

      <Card padding="none" className="overflow-hidden">
        <CardBody className="p-0">
          {loading && (
            <div className="space-y-3 p-5">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} variant="rectangular" height={88} />
              ))}
              <span className="sr-only">Loading tasks…</span>
            </div>
          )}

          {!loading && tasks.length > 0 && (
            <ul className="divide-y divide-border">
              {tasks.map((t) => {
                const overdue = isOverdue(t);
                const money = t.stepMoney;
                const hasIn = (money?.receivable?.count ?? 0) > 0;
                const hasOut = (money?.payable?.count ?? 0) > 0;
                return (
                  <li
                    key={t.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:p-5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {t.title}
                        </p>
                        <Badge
                          variant="soft"
                          size="sm"
                          text={TASK_STATUS_LABELS[t.status] ?? t.status}
                          className={`${CHIP} ${STATUS_TONE[t.status] ?? TONE.neutral}`}
                        />
                        {overdue && (
                          <Badge
                            variant="soft"
                            size="sm"
                            text="Overdue"
                            icon={<Clock className="h-3 w-3" />}
                            className={`${CHIP} ${TONE.danger}`}
                          />
                        )}
                      </div>

                      <p className="mt-1 text-xs text-muted-foreground">
                        {t.departmentName}
                        {t.shipmentRef ? ` · ${t.shipmentRef}` : ""}
                        {t.assigneeName
                          ? ` · ${t.assigneeName}`
                          : " · unassigned (queue)"}
                        {t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ""}
                      </p>

                      {/* What this step is worth, both ways round. Receivable reads as
                          success and payable as warning, the same pairing the shipment
                          screen uses for an invoice's kind. */}
                      {(hasIn || hasOut) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {hasIn && (
                            <Badge
                              variant="soft"
                              size="sm"
                              text={`IN ${compact(money.receivable.total)}`}
                              className={`${CHIP} ${TONE.success}`}
                            />
                          )}
                          {hasOut && (
                            <Badge
                              variant="soft"
                              size="sm"
                              text={`OUT ${compact(money.payable.total)}`}
                              className={`${CHIP} ${TONE.warning}`}
                            />
                          )}
                        </div>
                      )}

                      {t.description && (
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          {t.description}
                        </p>
                      )}
                    </div>

                    {/* Full-width buttons on a phone, natural width from `sm`. */}
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                      {t.shipmentId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-3"
                          iconAfter={<ArrowRight className="h-3.5 w-3.5" />}
                          onClick={() =>
                            navigate(`/admin/shipments/${t.shipmentId}`)
                          }
                        >
                          Open
                        </Button>
                      )}
                      {!t.assigneeId &&
                        ["queued", "open"].includes(t.status) &&
                        hasPermission("task.update") && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-3"
                            disabled={busy}
                            iconBefore={<Hand className="h-3.5 w-3.5" />}
                            onClick={() =>
                              act(() => claimTask(t.id), "Task claimed")
                            }
                          >
                            Claim
                          </Button>
                        )}
                      {["open", "in_progress"].includes(t.status) &&
                        hasPermission("task.complete") && (
                          <Button
                            size="sm"
                            className="h-8 px-3"
                            disabled={busy}
                            iconBefore={<CheckCircle2 className="h-3.5 w-3.5" />}
                            onClick={() =>
                              act(() => completeTask(t.id), "Task completed")
                            }
                          >
                            Complete
                          </Button>
                        )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!loading && tasks.length === 0 && !error && (
            <EmptyState
              icon={<ListChecks />}
              title="Your queue is clear"
              description="Work lands here as shipments reach a step your department owns."
              className="py-14"
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default TasksListPage;
