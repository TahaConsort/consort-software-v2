import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  ensureUserChannels,
  getUserDepartmentId,
  isMember,
  hydrateMessages,
  persistMessage,
  markChannelRead,
  unreadCount,
  channelWriteBlockReason,
  getOrCreateDirectChannel,
  editMessage,
  softDeleteMessage,
} from "./chat.service.js";

/**
 * Internal Chat (CRM_MASTER §5.14, RULE-CH). Inter-department communication:
 * a General channel, one channel per Department, and one auto-created channel
 * per Shipment (RULE-QT-07). Customers are never members (INV-11).
 */

/* ── GET /api/chat/channels ── */
export const listChannels = catchAsync(async (req, res) => {
  // Make sure the caller has their general + department memberships.
  const departmentId = await getUserDepartmentId(req.user.id);
  await ensureUserChannels(req.user.id, departmentId);

  const memberships = await prisma.chatChannelMember.findMany({
    where: { userId: req.user.id, leftAt: null },
    include: { channel: true },
  });

  const channels = await Promise.all(
    memberships.map(async (m) => {
      const lastMessage = await prisma.chatMessage.findFirst({
        where: { channelId: m.channelId, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      return {
        id: m.channel.id,
        type: m.channel.type,
        name: m.channel.name,
        shipmentId: m.channel.shipmentId,
        readOnly: !!(await channelWriteBlockReason(m.channelId)), // RULE-CH-03
        unread: await unreadCount(m.channelId, req.user.id, m.lastReadMessageId),
        lastMessageAt: lastMessage?.createdAt ?? m.channel.createdAt,
        lastMessagePreview: lastMessage?.deletedAt ? "(deleted)" : lastMessage?.body?.slice(0, 80) ?? null,
      };
    }),
  );

  channels.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  res.json({ success: true, data: channels });
});

/* ── GET /api/chat/channels/:id/messages ── */
export const getMessages = catchAsync(async (req, res, next) => {
  if (!(await isMember(req.params.id, req.user.id))) {
    return next(new AppError("Channel not found", 404)); // no existence leak (§2.3)
  }
  const messages = await prisma.chatMessage.findMany({
    where: { channelId: req.params.id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  res.json({ success: true, data: await hydrateMessages(messages) });
});

/* ── POST /api/chat/channels/:id/messages ── */
export const sendMessage = catchAsync(async (req, res, next) => {
  if (!(await isMember(req.params.id, req.user.id))) {
    return next(new AppError("Channel not found", 404));
  }
  const blocked = await channelWriteBlockReason(req.params.id); // RULE-CH-03
  if (blocked) return next(new AppError(blocked, 409));

  const dto = await persistMessage({
    channelId: req.params.id,
    senderId: req.user.id,
    clientMessageId: req.body.clientMessageId,
    body: req.body.body,
    replyToId: req.body.replyToId,
  });
  res.status(201).json({ success: true, data: dto });
});

/* ── PATCH /api/chat/messages/:messageId ── (edit within window, RULE-CH-02) */
export const editChatMessage = catchAsync(async (req, res, next) => {
  const r = await editMessage(req.params.messageId, req.user.id, req.body.body);
  if (r.error) return next(new AppError(r.error, r.status));
  res.json({ success: true, data: r.dto });
});

/* ── DELETE /api/chat/messages/:messageId ── (soft delete) */
export const deleteChatMessage = catchAsync(async (req, res, next) => {
  const r = await softDeleteMessage(req.params.messageId, req.user.id);
  if (r.error) return next(new AppError(r.error, r.status));
  res.json({ success: true, message: "Message deleted" });
});

/* ── GET /api/chat/colleagues ── (internal users to start a DM with, INV-11) */
export const listColleagues = catchAsync(async (req, res) => {
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { not: "customer" }, id: { not: req.user.id } },
    select: { id: true, email: true, role: true, employee: { select: { firstName: true, lastName: true } } },
    orderBy: { email: "asc" },
  });
  res.json({
    success: true,
    data: users.map((u) => ({
      id: u.id,
      role: u.role,
      name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u.email,
    })),
  });
});

/* ── POST /api/chat/direct ── (open/find a 1:1 direct channel) */
export const openDirectChannel = catchAsync(async (req, res, next) => {
  const target = await prisma.user.findFirst({
    where: { id: req.body.userId, isActive: true, role: { not: "customer" } },
    select: { id: true },
  });
  if (!target) return next(new AppError("User not found", 404));
  const channel = await getOrCreateDirectChannel(req.user.id, target.id);
  res.json({ success: true, data: { channelId: channel.id } });
});

/* ── POST /api/chat/channels/:id/read ── */
export const markRead = catchAsync(async (req, res, next) => {
  if (!(await isMember(req.params.id, req.user.id))) {
    return next(new AppError("Channel not found", 404));
  }
  await markChannelRead(req.params.id, req.user.id, req.body.lastReadMessageId);
  res.json({ success: true, message: "Marked read" });
});
