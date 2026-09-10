import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, RefreshCw, CheckCheck, SlidersHorizontal, Lock } from "lucide-react";
import toast from "react-hot-toast";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  Skeleton,
} from "@neuctra/ui";
import { useNotificationStore } from "@/store/notificationStore";

/** One 36px baseline across the toolbar, as on the leads and queries screens. */
const ACTION_BTN = "h-9 px-3";
const CHIP = "shrink-0 whitespace-nowrap border text-xs";
const NEUTRAL_CHIP = "border-border bg-muted text-muted-foreground";
const WARNING_CHIP = "border-warning/30 bg-warning/10 text-warning";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "");
const prettyType = (t) =>
  String(t ?? "")
    .replace(/[._]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/**
 * NotificationsPage — the in-app feed written by the outbox relay
 * (CRM_MASTER §5.15). Clicking a notification marks it read and follows
 * its action link.
 */
const NotificationsPage = () => {
  const {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    markRead,
    markAllRead,
    preferences,
    prefsLoading,
    fetchPreferences,
    togglePreference,
  } = useNotificationStore();
  const navigate = useNavigate();
  const [showPrefs, setShowPrefs] = useState(false);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (showPrefs && preferences.length === 0) fetchPreferences();
  }, [showPrefs, preferences.length, fetchPreferences]);

  const open = async (n) => {
    if (!n.readAt) await markRead(n.id);
    if (n.actionUrl) navigate(n.actionUrl);
  };

  const onToggle = async (type, channel, enabled) => {
    try {
      await togglePreference(type, channel, enabled);
    } catch (err) {
      toast.error(err?.message || "Could not update preference");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Bell className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Notifications
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={showPrefs ? "secondary" : "ghost"}
            size="sm"
            className={ACTION_BTN}
            onClick={() => setShowPrefs((v) => !v)}
            aria-expanded={showPrefs}
            iconBefore={<SlidersHorizontal className="h-4 w-4" />}
          >
            Preferences
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={ACTION_BTN}
            onClick={fetchNotifications}
            disabled={loading}
            iconBefore={
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            }
          >
            Refresh
          </Button>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className={ACTION_BTN}
              onClick={markAllRead}
              iconBefore={<CheckCheck className="h-4 w-4" />}
            >
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* Preferences (RULE-NT-01 — task.assigned and shipment.held can't be muted) */}
      {showPrefs && (
        <Card padding="none" className="overflow-hidden">
          <CardHeader
            title="Delivery preferences"
            description="Nobody can opt out of learning they own work, or that their shipment stopped."
            className="border-b border-border bg-accent px-5 py-3"
            titleClassName="text-base font-semibold"
          />
          <CardBody className="p-0">
            {prefsLoading && preferences.length === 0 && (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} variant="rectangular" height={20} />
                ))}
              </div>
            )}

            <ul className="divide-y divide-border">
              {preferences.map((p) => (
                <li
                  key={p.type}
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-3"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                    {prettyType(p.type)}
                    {p.mandatory && (
                      <Badge
                        variant="soft"
                        size="sm"
                        text="mandatory"
                        icon={<Lock className="h-3 w-3" />}
                        className={`${CHIP} ${WARNING_CHIP}`}
                      />
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-5">
                    {p.channels.map((c) => (
                      <Checkbox
                        key={c.channel}
                        /* The single-mode row is `justify-between` with the box last:
                           reversed and left-aligned it reads as a compact inline toggle. */
                        itemClassName="flex-row-reverse justify-start gap-2"
                        textClassName="text-xs text-muted-foreground"
                        iconSize={16}
                        label={c.channel.replace("_", "-")}
                        checked={c.enabled}
                        disabled={p.mandatory}
                        onCheckedChange={(v) =>
                          onToggle(p.type, c.channel, v === true)
                        }
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Feed */}
      <Card padding="none" className="overflow-hidden">
        <CardBody className="p-0">
          {loading && notifications.length === 0 && (
            <div className="space-y-4 p-5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} variant="rectangular" height={44} />
              ))}
              <span className="sr-only">Loading notifications…</span>
            </div>
          )}

          {notifications.length > 0 && (
            <ul className="divide-y divide-border">
              {notifications.map((n) => {
                const unread = !n.readAt;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => open(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 ${
                        unread ? "bg-primary/5" : ""
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-primary" : "bg-transparent"}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-3">
                          <span
                            className={`text-sm text-foreground ${unread ? "font-semibold" : "font-medium"}`}
                          >
                            {n.title}
                            {unread && <span className="sr-only"> (unread)</span>}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {fmt(n.createdAt)}
                          </span>
                        </span>
                        {n.body && (
                          <span
                            className="mt-0.5 block line-clamp-2 text-sm text-muted-foreground"
                            title={n.body}
                          >
                            {n.body}
                          </span>
                        )}
                        <span className="mt-1.5 block">
                          <Badge
                            variant="soft"
                            size="sm"
                            text={prettyType(n.type)}
                            className={`${CHIP} ${NEUTRAL_CHIP}`}
                          />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!loading && notifications.length === 0 && (
            <EmptyState
              icon={<Bell />}
              title="No notifications yet"
              description="Assignments, holds and approvals land here as they happen."
              className="py-14"
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default NotificationsPage;
