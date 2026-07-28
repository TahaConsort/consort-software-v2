/**
 * chatService.js — Internal Chat (CRM_MASTER §5.14). REST is complete without
 * sockets (ADR-007); the socket layer only pushes live updates.
 */
import api from "@/lib/axios";

export const listChannels = async () => {
  const res = await api.get("/chat/channels");
  return res.data;
};

export const getMessages = async (channelId) => {
  const res = await api.get(`/chat/channels/${channelId}/messages`);
  return res.data;
};

export const sendMessage = async (channelId, payload) => {
  const res = await api.post(`/chat/channels/${channelId}/messages`, payload);
  return res.data;
};

export const markRead = async (channelId, lastReadMessageId) => {
  const res = await api.post(`/chat/channels/${channelId}/read`, { lastReadMessageId });
  return res.data;
};

export const editMessage = async (messageId, body) => {
  const res = await api.patch(`/chat/messages/${messageId}`, { body });
  return res.data;
};

export const deleteMessage = async (messageId) => {
  const res = await api.delete(`/chat/messages/${messageId}`);
  return res.data;
};

export const listColleagues = async () => {
  const res = await api.get("/chat/colleagues");
  return res.data;
};

export const openDirect = async (userId) => {
  const res = await api.post("/chat/direct", { userId });
  return res.data;
};
