import { useEffect } from "react";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { useNotificationStore } from "@/store/notificationStore";
import { connectSocket, disconnectSocket, onSocket } from "@/lib/socket";
import { invalidate } from "@/lib/invalidationBus";
import { startRevalidation } from "@/lib/revalidate";
import { TOPICS } from "@/lib/topics";

/**
 * RealtimeBridge — one place that opens the Socket.IO connection once the user
 * is authenticated and turns live events into UI effects. Real-time is additive
 * (ADR-007): if socket.io-client isn't installed, everything still works over
 * REST — this component simply does nothing.
 *
 * `startRevalidation` is what makes the whole app self-refreshing: it maps the
 * generic `data:changed` topic list onto the stores that own those topics, and
 * catches up on reconnect and on tab focus. Individual pages no longer need their
 * own socket subscriptions.
 */
export default function RealtimeBridge() {
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      disconnectSocket();
      return;
    }

    // Registered before the socket resolves: onSocket parks listeners and replays
    // them on connect, so nothing is missed while the dynamic import loads.
    const stopRevalidation = startRevalidation();

    let cleanup = () => {};
    connectSocket(token).then((socket) => {
      if (!socket) return; // socket.io-client not installed — REST-only
      const offs = [
        onSocket("notification:new", (n) => {
          fetchNotifications();
          if (n?.title) toast(n.title, { icon: "🔔", id: n.id, duration: 5000 });
        }),
        onSocket("task:assigned", () => {
          // Toast AND refresh: the queue used to keep whatever it had until the
          // user reloaded, so an assignment they were just told about wasn't there.
          invalidate(TOPICS.TASKS, TOPICS.NOTIFICATIONS, TOPICS.DASHBOARD);
          toast("A task was assigned to you", { icon: "📋" });
        }),
      ];
      cleanup = () => offs.forEach((off) => off());
    });

    return () => {
      stopRevalidation();
      cleanup();
    };
  }, [isAuthenticated, token, fetchNotifications]);

  return null;
}
