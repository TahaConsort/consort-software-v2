import * as chatService from "@/services/chatService";
import { createResourceStore } from "@/lib/createResourceStore";
import { chatChannelTopic, TOPICS } from "@/lib/topics";

/**
 * Chat store (CRM_MASTER §5.14) — the channel list plus the open channel's messages.
 * Live socket events call `addIncoming` to keep it fresh; REST is the source of truth
 * (ADR-007). Genuinely realtime already, so this migration is about the guards.
 *
 * The channel is the read identity, which fixes a real bug: `openChannel` used to write
 * its response unconditionally, so clicking channel A then B quickly could land A's
 * messages while `activeChannelId` was B, with no recovery but a reload.
 */
export const useChatStore = createResourceStore({
  name: "chat",
  topics: [TOPICS.CHAT],
  topicOf: (s) => (s.activeChannelId ? [chatChannelTopic(s.activeChannelId)] : []),

  state: {
    channels: [],
    activeChannelId: null,
    messages: [],
  },

  keyOf: ([channelId], state) => channelId ?? state.activeChannelId ?? null,
  clearOnKeyChange: { messages: [] },

  load: async ({ args, get }) => {
    const channelId = args[0] ?? get().activeChannelId;
    // Both in one read: the list carries unread counts that the message read updates.
    const [msgRes, chanRes] = await Promise.allSettled([
      chatService.getMessages(channelId),
      chatService.listChannels(),
    ]);
    if (msgRes.status === "rejected") throw msgRes.reason;

    const messages = msgRes.value?.data ?? [];
    // Tell the server how far we have read, then clear this channel's badge locally.
    const last = messages.at(-1);
    if (last) chatService.markRead(channelId, last.id).catch(() => {});

    const channels = chanRes.status === "fulfilled"
      ? (chanRes.value?.data ?? []).map((c) => (c.id === channelId ? { ...c, unread: 0 } : c))
      : get().channels.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c));

    return { activeChannelId: channelId, messages, channels };
  },

  actions: ({ set, get, mutate }) => ({
    fetchChannels: async () => {
      try {
        const res = await chatService.listChannels();
        set({ channels: res.data ?? [], error: null });
      } catch (err) {
        set({ error: err?.message || "Failed to load channels" });
      }
    },

    openChannel: (channelId) => get().fetch(channelId),

    /**
     * Called by the socket handler on `chat:message` — covers new, edited and
     * soft-deleted messages, since an edit or delete pushes the same message id.
     */
    addIncoming: (message) => {
      const isActive = message.channelId === get().activeChannelId;
      if (isActive) {
        set((s) => {
          const idx = s.messages.findIndex((m) => m.id === message.id);
          if (idx >= 0) {
            const next = [...s.messages];
            next[idx] = { ...next[idx], ...message };
            return { messages: next };
          }
          return { messages: [...s.messages, message] };
        });
      }
      if (!isActive && !message.deletedAt) {
        set((s) => ({
          channels: s.channels.map((c) =>
            c.id === message.channelId
              ? { ...c, unread: (c.unread ?? 0) + 1, lastMessagePreview: message.body?.slice(0, 80) }
              : c,
          ),
        }));
      }
    },

    /** The response is the authoritative message, so patch rather than refetch. */
    editMessage: (messageId, body) =>
      mutate(() => chatService.editMessage(messageId, body), {
        refetch: false,
        patch: (res, g) => ({
          messages: g().messages.map((m) => (m.id === messageId ? res.data : m)),
          // The sidebar preview is derived from the last message, so an edit to it has to
          // move too — otherwise the list quotes text that no longer exists.
          channels: g().channels.map((c) =>
            c.id === g().activeChannelId && g().messages.at(-1)?.id === messageId
              ? { ...c, lastMessagePreview: res.data?.body?.slice(0, 80) ?? "" }
              : c,
          ),
        }),
      }),

    /**
     * Returns a message only, so refetch rather than invent a `deletedAt` client-side —
     * which is what this did, and it also left the sidebar preview quoting deleted text.
     */
    deleteMessage: (messageId) =>
      mutate(() => chatService.deleteMessage(messageId), {
        patch: (_res, g) => ({
          messages: g().messages.map((m) =>
            m.id === messageId ? { ...m, deletedAt: new Date().toISOString() } : m,
          ),
        }),
      }),

    startDirect: async (userId) => {
      const res = await chatService.openDirect(userId);
      await get().fetchChannels();
      await get().openChannel(res.data.channelId);
      return res.data.channelId;
    },
  }),
});
