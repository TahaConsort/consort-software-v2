import { create } from "zustand";
import * as notificationService from "@/services/notificationService";

/**
 * Notification store — feed + unread badge. Polled lightly from the layout
 * (REST is complete without sockets — WORKFLOW §7.3; live push is Phase-1.5).
 */
export const useNotificationStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  preferences: [],
  prefsLoading: false,

  fetchNotifications: async () => {
    set({ loading: true });
    try {
      const res = await notificationService.listNotifications();
      set({ notifications: res.data ?? [], unreadCount: res.unreadCount ?? 0, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchPreferences: async () => {
    set({ prefsLoading: true });
    try {
      const res = await notificationService.getPreferences();
      set({ preferences: res.data?.preferences ?? [], prefsLoading: false });
    } catch {
      set({ prefsLoading: false });
    }
  },

  // Optimistic toggle for one (type, channel), then persist.
  togglePreference: async (type, channel, enabled) => {
    set((s) => ({
      preferences: s.preferences.map((p) =>
        p.type === type ? { ...p, channels: p.channels.map((c) => (c.channel === channel ? { ...c, enabled } : c)) } : p,
      ),
    }));
    try {
      await notificationService.updatePreferences([{ type, channel, enabled }]);
      return true;
    } catch (err) {
      await get().fetchPreferences(); // revert to server truth (e.g. mandatory type)
      throw err;
    }
  },

  markRead: async (id) => {
    await notificationService.markRead(id);
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }));
  },

  markAllRead: async () => {
    await notificationService.markAllRead();
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
      unreadCount: 0,
    }));
  },
}));
