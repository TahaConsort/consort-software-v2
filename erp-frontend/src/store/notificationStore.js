import * as notificationService from "@/services/notificationService";
import { createResourceStore } from "@/lib/createResourceStore";
import { TOPICS } from "@/lib/topics";

/**
 * Notification store — the feed and the unread badge.
 *
 * `notification:new` already pushes live (RealtimeBridge), so the feed no longer needs
 * polling. It was previously polled every 60s from TWO components at once, and each poll
 * raised `loading` — which spun the Notifications page's refresh icon unprompted twice a
 * minute. `refreshing` replaces that.
 *
 * Preferences load lazily and are kept in the same store; `togglePreference` stays
 * optimistic-then-revert, which is the right shape here — the server may refuse to
 * disable a mandatory type, and reverting to server truth is the only correct recovery.
 */
export const useNotificationStore = createResourceStore({
  name: "notifications",
  topics: [TOPICS.NOTIFICATIONS],

  state: {
    notifications: [],
    unreadCount: 0,
    preferences: [],
    prefsLoading: false,
  },

  load: async () => {
    const res = await notificationService.listNotifications();
    return { notifications: res.data ?? [], unreadCount: res.unreadCount ?? 0 };
  },

  actions: ({ set, get, mutate }) => ({
    fetchNotifications: (opts = {}) => get().fetch(opts),

    fetchPreferences: async () => {
      set({ prefsLoading: true });
      try {
        const res = await notificationService.getPreferences();
        set({ preferences: res.data?.preferences ?? [], prefsLoading: false });
      } catch (err) {
        // Surfaced rather than swallowed: this store had no `error` field at all, so a
        // failing feed was indistinguishable from an empty one and the only diagnostic
        // available to the user was a reload.
        set({ prefsLoading: false, error: err?.message || "Failed to load notification preferences" });
      }
    },

    /** Optimistic toggle for one (type, channel), then persist. */
    togglePreference: async (type, channel, enabled) => {
      set((s) => ({
        preferences: s.preferences.map((p) =>
          p.type === type
            ? { ...p, channels: p.channels.map((c) => (c.channel === channel ? { ...c, enabled } : c)) }
            : p,
        ),
      }));
      try {
        await notificationService.updatePreferences([{ type, channel, enabled }]);
        return true;
      } catch (err) {
        await get().fetchPreferences(); // revert to server truth (e.g. a mandatory type)
        throw err;
      }
    },

    /**
     * Patched straight from the response, which returns the updated row — this used to
     * discard it and invent a `readAt` client-side. No refetch and no topic: every
     * consumer reads this one store instance, so the patch is already the whole update
     * and marking one item read costs no round trip.
     */
    markRead: (id) =>
      mutate(() => notificationService.markRead(id), {
        refetch: false,
        patch: (res, g) => ({
          notifications: g().notifications.map((n) => (n.id === id ? { ...n, ...(res?.data ?? {}) } : n)),
          unreadCount: Math.max(0, g().unreadCount - 1),
        }),
      }),

    /** Returns a message only, so patch optimistically and let the refetch confirm. */
    markAllRead: () =>
      mutate(() => notificationService.markAllRead(), {
        patch: (_res, g) => ({
          notifications: g().notifications.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
          unreadCount: 0,
        }),
      }),
  }),
});
