import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Pause,
  Ban,
  CalendarClock,
  MapPin,
  UserCheck,
  FileText,
} from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  Progress,
  Skeleton,
  Spinner,
  Tooltip,
} from "@neuctra/ui";
import { useShipmentDetailStore } from "@/store/shipmentDetailStore";
import { joinRoom } from "@/lib/socket";
import { SHIPMENT_STATUS_LABELS, routeOf } from "@/lib/catalog";

/**
 * ShipmentStatusPage — the read-only face of a shipment.
 *
 * Sales roles (BDO, ASM) hold `shipment.read` and no shipment write permission at all,
 * so the management screen showed them a stepper whose every button was hidden and a
 * documents panel they could not act on. This is what they actually need: where the job
 * has got to, and when it is due.
 *
 * Deliberately absent, and not merely hidden: the OTD action bar, per-step documents and
 * invoices, and the job P&L. The P&L matters most — a BDO holds `report.read`, so on the
 * management page `canViewPnl` was true and the cost/margin block rendered for a sales
 * role. This page never asks for it.
 */

const CHIP = "shrink-0 whitespace-nowrap border text-xs";
const TONE = {
  neutral: "border-border bg-muted text-muted-foreground",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  success: "border-success/30 bg-success/10 text-success",
};

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Not set";

const prettyStep = (code) =>
  String(code ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * One cell of the summary grid. The hairlines come from the parent's `gap-px` over a
 * border-coloured background rather than a border on every cell, so the grid stays
 * correct however it reflows. Renders nothing without a value.
 */
const Fact = ({ label, value, icon: Icon }) => {
  if (!value) return null;
  return (
    <div className="bg-card p-3 sm:p-4">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />} {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
};

const ShipmentStatusPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const detail = useShipmentDetailStore();
  const { shipment, refreshing, error } = detail;

  useEffect(() => {
    // `canViewPnl: false` is the point, not a default: the P&L endpoint is never called
    // for this viewer even though their role would pass its permission check.
    detail.fetch(id, { canViewPnl: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store actions are stable
  }, [id]);

  // Live tracking: the relay's fan-out carries the `shipment:{id}` topic, so a step Ops
  // completes on their screen moves this one without a reload.
  useEffect(() => joinRoom("shipment", id), [id]);

  if (!shipment && !error)
    return (
      <div className="space-y-5">
        <Skeleton variant="rectangular" height={160} />
        <Skeleton variant="rectangular" height={256} />
        <span className="sr-only">Loading shipment…</span>
      </div>
    );

  if (error && !shipment)
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          iconBefore={<ArrowLeft className="h-4 w-4" />}
          onClick={() => navigate("/admin/shipments")}
        >
          Back to shipments
        </Button>
        <Callout type="error" title="Couldn't load this shipment">
          {error}
        </Callout>
      </div>
    );

  const held = shipment.exceptionState === "on_hold";
  const cancelled = shipment.exceptionState === "cancelled";
  const steps = shipment.otdSteps ?? [];
  const doneSteps = steps.filter((s) => s.status === "done").length;
  const progressPct = steps.length
    ? Math.round((doneSteps / steps.length) * 100)
    : 0;
  const firstPendingDisplayNo = steps.find(
    (s) => s.status === "pending",
  )?.displayNo;

  return (
    <div className="space-y-5 pb-10">
      <div className="-mx-4 px-4">
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          iconBefore={<ArrowLeft className="h-4 w-4" />}
          onClick={() => navigate("/admin/shipments")}
        >
          Shipments
        </Button>
      </div>

      {/* Summary */}
      <Card padding="none" className="overflow-hidden">
        <CardBody>
          <div className="flex flex-col gap-4 border-b border-border p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight text-primary sm:text-2xl">
                  {shipment.referenceNo}
                </h1>
                <Badge
                  variant="outline"
                  size="sm"
                  text={SHIPMENT_STATUS_LABELS[shipment.status] ?? shipment.status}
                  className={`${CHIP} ${TONE.neutral}`}
                />
                {refreshing && (
                  <Tooltip content="Refreshing">
                    <span className="inline-flex text-muted-foreground">
                      <Spinner size="xs" label="Refreshing" />
                    </span>
                  </Tooltip>
                )}
                {held && (
                  <Badge
                    variant="soft"
                    size="sm"
                    text="On Hold"
                    icon={<Pause className="h-3 w-3" />}
                    className={`${CHIP} ${TONE.warning}`}
                  />
                )}
                {cancelled && (
                  <Badge
                    variant="soft"
                    size="sm"
                    text="Cancelled"
                    icon={<Ban className="h-3 w-3" />}
                    className={`${CHIP} ${TONE.danger}`}
                  />
                )}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {shipment.customerCompany} · {shipment.customerRef}
              </p>
            </div>

            <div className="w-full shrink-0 rounded-lg border border-border bg-accent p-3 lg:w-64">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Progress
                </span>
                <span className="text-sm font-semibold">
                  {doneSteps}
                  <span className="text-muted-foreground">/{steps.length}</span>
                </span>
              </div>
              <Progress
                className="mt-2"
                value={progressPct}
                label="Steps completed"
                size="sm"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {progressPct}% of steps confirmed
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-5">
            <Fact label="Route" value={routeOf(shipment)} icon={MapPin} />
            <Fact label="ETD" value={fmtDate(shipment.etd)} icon={CalendarClock} />
            <Fact label="ETA" value={fmtDate(shipment.eta)} icon={CalendarClock} />
            <Fact
              label="Run by"
              value={shipment.opsOwnerName ?? "Nobody yet"}
              icon={UserCheck}
            />
            {shipment.incoterm && (
              <Fact label="Incoterm" value={shipment.incoterm} icon={FileText} />
            )}
          </dl>
        </CardBody>
      </Card>

      {held && (
        <Callout type="warning" title="This shipment is on hold">
          Progress is paused until Operations resumes it.
        </Callout>
      )}
      {cancelled && (
        <Callout type="error" title="This shipment was cancelled">
          It stays on record for reporting, but nothing further is recorded
          against it.
        </Callout>
      )}

      {/* Where the job has got to. Names and states only: no controls, because this
          viewer holds no shipment write permission for the server to accept. */}
      <Card padding="none" className="overflow-hidden">
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-accent px-4 py-3 sm:px-5">
            <h2 className="font-semibold">Progress</h2>
            <span className="text-xs text-muted-foreground">
              {steps.length} steps on this path
            </span>
          </div>

          <ol className="divide-y divide-border">
            {steps.map((step) => {
              const done = step.status === "done";
              const isNext = step.displayNo === firstPendingDisplayNo;
              return (
                <li key={step.id} className="relative">
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 w-1 ${done ? "bg-success" : isNext ? "bg-primary" : "bg-transparent"}`}
                  />
                  <div className="flex items-start gap-3 p-3 pl-4 sm:p-4 sm:pl-5">
                    {done ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                    ) : (
                      <Circle
                        className={`mt-0.5 h-5 w-5 shrink-0 ${isNext ? "text-primary" : "text-muted-foreground/40"}`}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}
                        >
                          {step.displayNo}.{" "}
                          {step.title ?? prettyStep(step.stepCode)}
                        </p>
                        {isNext && !done && (
                          <Badge text="In progress" size="sm" className="shrink-0" />
                        )}
                      </div>
                      {done && step.completedAt && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Confirmed {fmtDate(step.completedAt)}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {steps.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">
              No steps composed on this shipment yet.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default ShipmentStatusPage;
