import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, RefreshCw, CheckCheck, SlidersHorizontal, Lock } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useNotificationStore } from "@/store/notificationStore";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "");
const prettyType = (t) => t.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * NotificationsPage — the in-app feed written by the outbox relay
 * (CRM_MASTER §5.15). Clicking a notification marks it read and follows
 * its action link.
 */
const NotificationsPage = () => {
  const {
    notifications, unreadCount, loading, fetchNotifications, markRead, markAllRead,
    preferences, prefsLoading, fetchPreferences, togglePreference,
  } = useNotificationStore();
  const navigate = useNavigate();
  const [showPrefs, setShowPrefs] = useState(false);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);
  useEffect(() => { if (showPrefs && preferences.length === 0) fetchPreferences(); }, [showPrefs, preferences.length, fetchPreferences]);

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
    <div className="space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><Bell className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Notifications</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowPrefs((v) => !v)} className="gap-2">
            <SlidersHorizontal className="w-4 h-4" /> Preferences
          </Button>
          <Button variant="outline" size="sm" onClick={fetchNotifications} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          {unreadCount > 0 && (
            <Button size="sm" variant="outline" onClick={markAllRead} className="gap-2">
              <CheckCheck className="w-4 h-4" /> Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* Preferences (RULE-NT-01 — task.assigned & shipment.held can't be muted) */}
      {showPrefs && (
        <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm p-5 space-y-3">
          <h2 className="font-semibold text-sm">Delivery preferences</h2>
          {prefsLoading && preferences.length === 0 && <p className="text-sm text-muted-foreground">Loading…</p>}
          <div className="space-y-1.5">
            {preferences.map((p) => (
              <div key={p.type} className="flex items-center justify-between gap-4 py-1.5 border-b last:border-0">
                <span className="text-sm flex items-center gap-2">
                  {prettyType(p.type)}
                  {p.mandatory && <Badge variant="outline" className="text-[10px] gap-1 border-amber-400 text-amber-700 dark:text-amber-300"><Lock className="w-2.5 h-2.5" /> mandatory</Badge>}
                </span>
                <div className="flex items-center gap-4">
                  {p.channels.map((c) => (
                    <label key={c.channel} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={c.enabled}
                        disabled={p.mandatory}
                        onCheckedChange={(v) => onToggle(p.type, c.channel, v === true)}
                      />
                      {c.channel.replace("_", "-")}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Nobody can opt out of learning they own work or that their shipment stopped (RULE-NT-01).</p>
        </div>
      )}

      {/* Feed */}
      <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm divide-y">
        {loading && notifications.length === 0 && (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-5 bg-muted rounded animate-pulse w-2/3" />)}
          </div>
        )}

        {notifications.map((n) => (
          <button
            key={n.id}
            onClick={() => open(n)}
            className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/40 transition
              ${!n.readAt ? "bg-primary/5" : ""}`}
          >
            <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${!n.readAt ? "bg-primary" : "bg-transparent"}`} />
            <span className="flex-1 min-w-0">
              <span className="flex items-center justify-between gap-2">
                <span className={`text-sm ${!n.readAt ? "font-semibold" : "font-medium"}`}>{n.title}</span>
                <span className="text-xs text-muted-foreground flex-shrink-0">{fmt(n.createdAt)}</span>
              </span>
              {n.body && <span className="block text-sm text-muted-foreground line-clamp-2" title={n.body}>{n.body}</span>}
              <Badge variant="secondary" className="mt-1 text-[10px]">{prettyType(n.type)}</Badge>
            </span>
          </button>
        ))}

        {!loading && notifications.length === 0 && (
          <div className="p-10 text-center text-muted-foreground">
            <Bell className="w-8 h-8 opacity-30 mx-auto mb-2" />
            <p className="font-medium">No notifications yet</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
