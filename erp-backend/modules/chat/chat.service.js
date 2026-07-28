import prisma from "../../config/prisma.js";
import { emitToRoom } from "../../realtime/io.js";

/**
 * Chat shared logic (CRM_MASTER §5.14, RULE-CH) — used by BOTH the REST
 * controllers and the Socket.IO gateway, so a message persists and broadcasts
 * identically however it arrives.
 *
 * Channels: shipment (auto at shipment birth), department, general, direct.
 * Customers are NEVER members (INV-11) — enforced by gating chat routes/socket
 * to internal roles only.
 */

export const getUserDepartmentId = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { employee: { select: { departmentId: true } } },
  });
  return user?.employee?.departmentId ?? null;
};

/** Provision the general + own-department memberships for an internal user. */
export const ensureUserChannels = async (userId, departmentId) => {
  // General — one shared channel.
  let general = await prisma.chatChannel.findFirst({ where: { type: "general" } });
  if (!general) general = await prisma.chatChannel.create({ data: { type: "general", name: "General" } });
  await joinChannel(general.id, userId);

  // Department — one per department.
  if (departmentId) {
    let dept = await prisma.chatChannel.findFirst({ where: { type: "department", departmentId } });
    if (!dept) {
      const d = await prisma.department.findUnique({ where: { id: departmentId } });
      dept = await prisma.chatChannel.create({
        data: { type: "department", departmentId, name: `${d?.name ?? "Department"} Team` },
      });
    }
    await joinChannel(dept.id, userId);
  }
};

/** Idempotent membership add (re-activates a left member). */
export const joinChannel = async (channelId, userId) => {
  const existing = await prisma.chatChannelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  });
  if (!existing) {
    await prisma.chatChannelMember.create({ data: { channelId, userId } });
  } else if (existing.leftAt) {
    await prisma.chatChannelMember.update({ where: { id: existing.id }, data: { leftAt: null } });
  }
};

export const isMember = async (channelId, userId) => {
  const m = await prisma.chatChannelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  });
  return !!m && !m.leftAt;
};

export const userChannelIds = async (userId) => {
  const rows = await prisma.chatChannelMember.findMany({
    where: { userId, leftAt: null },
    select: { channelId: true },
  });
  return rows.map((r) => r.channelId);
};

/** Attach sender display names to a batch of messages. */
export const hydrateMessages = async (messages) => {
  const senderIds = [...new Set(messages.map((m) => m.senderId))];
  const users = await prisma.user.findMany({
    where: { id: { in: senderIds } },
    select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return messages.map((m) => {
    const u = byId.get(m.senderId);
    return {
      ...m,
      senderName: u?.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u?.email ?? "—",
    };
  });
};

const EDIT_WINDOW_MS = 15 * 60 * 1000; // messages editable for 15 min (RULE-CH-02)

/**
 * A shipment channel goes READ-ONLY once its shipment is cancelled or closed
 * (RULE-CH-03). Returns a reason string if writes are blocked, else null.
 */
export const channelWriteBlockReason = async (channelId) => {
  const channel = await prisma.chatChannel.findUnique({
    where: { id: channelId },
    select: { type: true, shipmentId: true },
  });
  if (channel?.type === "shipment" && channel.shipmentId) {
    const shipment = await prisma.shipment.findUnique({
      where: { id: channel.shipmentId },
      select: { status: true, exceptionState: true },
    });
    if (shipment?.exceptionState === "cancelled" || ["settled", "closed"].includes(shipment?.status)) {
      return "This shipment's chat is read-only (RULE-CH-03).";
    }
  }
  return null;
};

/**
 * Find-or-create a 1:1 direct channel between two internal users (RULE-CH-01).
 * Deterministic name key so the same pair always resolves to one channel.
 */
export const getOrCreateDirectChannel = async (userA, userB) => {
  const key = `dm:${[userA, userB].sort().join(":")}`;
  let channel = await prisma.chatChannel.findFirst({ where: { type: "direct", name: key } });
  if (!channel) {
    channel = await prisma.chatChannel.create({ data: { type: "direct", name: key } });
    await prisma.chatChannelMember.createMany({
      data: [{ channelId: channel.id, userId: userA }, { channelId: channel.id, userId: userB }],
      skipDuplicates: true,
    });
  } else {
    await joinChannel(channel.id, userA);
    await joinChannel(channel.id, userB);
  }
  return channel;
};

/** Edit a message within the edit window (author only). */
export const editMessage = async (messageId, senderId, body) => {
  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.deletedAt) return { error: "Message not found", status: 404 };
  if (msg.senderId !== senderId) return { error: "You can only edit your own messages", status: 403 };
  if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) return { error: "Edit window has passed", status: 409 };
  const updated = await prisma.chatMessage.update({ where: { id: messageId }, data: { body, editedAt: new Date() } });
  const [dto] = await hydrateMessages([updated]);
  emitToRoom(`channel:${msg.channelId}`, "chat:message", dto);
  return { dto };
};

/** Soft-delete a message (author, or any member for moderation is out of scope). */
export const softDeleteMessage = async (messageId, senderId) => {
  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.deletedAt) return { error: "Message not found", status: 404 };
  if (msg.senderId !== senderId) return { error: "You can only delete your own messages", status: 403 };
  await prisma.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
  emitToRoom(`channel:${msg.channelId}`, "chat:message", { id: messageId, channelId: msg.channelId, deletedAt: new Date() });
  return { ok: true };
};

/**
 * Persist a message idempotently (client message id, RULE-CH-02) and broadcast
 * it to the channel room. Returns the hydrated DTO.
 */
export const persistMessage = async ({ channelId, senderId, clientMessageId, body, replyToId }) => {
  let message;
  try {
    message = await prisma.chatMessage.create({
      data: { channelId, senderId, clientMessageId, body, replyToId: replyToId ?? null },
    });
  } catch (err) {
    if (err?.code === "P2002") {
      // Duplicate send — return the already-stored row (idempotent).
      message = await prisma.chatMessage.findUnique({
        where: { channelId_clientMessageId: { channelId, clientMessageId } },
      });
    } else {
      throw err;
    }
  }
  const [dto] = await hydrateMessages([message]);
  emitToRoom(`channel:${channelId}`, "chat:message", dto); // invalidation hint (EDGE-T-05)
  return dto;
};

export const markChannelRead = async (channelId, userId, lastReadMessageId) => {
  await prisma.chatChannelMember.updateMany({
    where: { channelId, userId },
    data: { lastReadMessageId },
  });
  emitToRoom(`channel:${channelId}`, "chat:read", { channelId, userId, lastReadMessageId });
};

/** Unread count for one member (messages after their read marker, not their own). */
export const unreadCount = async (channelId, userId, lastReadMessageId) => {
  let after = null;
  if (lastReadMessageId) {
    const marker = await prisma.chatMessage.findUnique({
      where: { id: lastReadMessageId },
      select: { createdAt: true },
    });
    after = marker?.createdAt ?? null;
  }
  return prisma.chatMessage.count({
    where: {
      channelId,
      deletedAt: null,
      senderId: { not: userId },
      ...(after ? { createdAt: { gt: after } } : {}),
    },
  });
};
