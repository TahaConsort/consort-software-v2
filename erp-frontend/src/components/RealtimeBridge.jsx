import { useEffect } from "react";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { useNotificationStore } from "@/store/notificationStore";
import { connectSocket, disconnectSocket, onSocket } from "@/lib/socket";

/**
 * RealtimeBridge — one place that opens the Socket.IO connection once the user
 * is authenticated and turns live events into UI effects. Real-time is additive
 * (ADR-007): if socket.io-client isn't installed, everything still works over
 * REST — this component simply does nothing.
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

    let cleanup = () => {};
    connectSocket(token).then((socket) => {
      if (!socket) return; // socket.io-client not installed — REST-only
      const offs = [
        onSocket("notification:new", (n) => {
          fetchNotifications();
          if (n?.title) toast(n.title, { icon: "🔔", id: n.id, duration: 5000 });
        }),
        onSocket("task:assigned", () => toast("A task was assigned to you", { icon: "📋" })),
      ];
      cleanup = () => offs.forEach((off) => off());
    });

    return () => cleanup();
  }, [isAuthenticated, token, fetchNotifications]);

  return null;
}
