import { create } from "zustand";
import * as chatService from "@/services/chatService";

/**
 * Chat store (CRM_MASTER §5.14). Holds channel list + the open channel's
 * messages. Live socket events call addIncoming/upsert to keep it fresh; REST
 * is the source of truth (ADR-007).
 */
export const useChatStore = create((set, get) => ({
  channels: [],
  activeChannelId: null,
  messages: [],
  loading: false,
  error: null,

  fetchChannels: async () => {
    try {
      const res = await chatService.listChannels();
      set({ channels: res.data ?? [] });
    } catch (err) {
      set({ error: err?.message || "Failed to load channels" });
    }
  },

  openChannel: async (channelId) => {
    set({ activeChannelId: channelId, loading: true, messages: [] });
    try {
      const res = await chatService.getMessages(channelId);
      set({ messages: res.data ?? [], loading: false });
      // Clear unread for this channel locally.
      set((s) => ({ channels: s.channels.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c)) }));
      const last = (res.data ?? []).at(-1);
      if (last) chatService.markRead(channelId, last.id).catch(() => {});
    } catch (err) {
      set({ error: err?.message || "Failed to load messages", loading: false });
    }
  },

  // Called by the socket handler on chat:message — handles new, edited and
  // soft-deleted messages (an edit/delete pushes the same message id).
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
          c.id === message.channelId ? { ...c, unread: (c.unread ?? 0) + 1, lastMessagePreview: message.body?.slice(0, 80) } : c,
        ),
      }));
    }
  },

  editMessage: async (messageId, body) => {
    const res = await chatService.editMessage(messageId, body);
    set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? res.data : m)) }));
  },

  deleteMessage: async (messageId) => {
    await chatService.deleteMessage(messageId);
    set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? { ...m, deletedAt: new Date().toISOString() } : m)) }));
  },

  startDirect: async (userId) => {
    const res = await chatService.openDirect(userId);
    await get().fetchChannels();
    await get().openChannel(res.data.channelId);
    return res.data.channelId;
  },
}));
