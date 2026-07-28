import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";

/**
 * Notifications (CRM_MASTER §5.15) — in-app channel, written by the outbox
 * relay's consumers. Phase-1: list, unread count, mark read, and per-type/
 * per-channel preferences with two operationally mandatory exceptions that can
 * never be muted (RULE-NT-01).
 */

// The Phase-1 notifiable types a user may tune. `task.assigned` and
// `shipment.held` are OMITTED here on purpose — they are mandatory (RULE-NT-01).
export const NOTIFIABLE_TYPES = [
  "quotation.sent", "quotation.approved", "quotation.rejected", "quotation.expiring",
  "shipment.created", "shipment.resumed", "shipment.cancelled", "shipment.closed",
  "invoice.issued", "payment.received", "task.overdue", "task.unassigned",
  "lead.converted", "visit.scheduled", "visit.no_show",
];
export const MANDATORY_TYPES = ["task.assigned", "shipment.held"];
export const NOTIF_CHANNELS = ["in_app", "email"]; // whatsapp is a Phase-1.5 stub

// GET /api/notifications — own, newest first, with unread count
export const listNotifications = catchAsync(async (req, res) => {
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
  ]);

  res.json({ success: true, data: notifications, unreadCount });
});

// PATCH /api/notifications/:id/read
export const markRead = catchAsync(async (req, res) => {
  const updated = req.notification.readAt
    ? req.notification
    : await prisma.notification.update({
        where: { id: req.notification.id },
        data: { readAt: new Date() },
      });
  res.json({ success: true, data: updated });
});

// POST /api/notifications/read-all
export const markAllRead = catchAsync(async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ success: true, message: "All notifications marked read" });
});

// GET /api/notifications/preferences — the tunable matrix + current values
export const getPreferences = catchAsync(async (req, res) => {
  const rows = await prisma.notificationPreference.findMany({ where: { userId: req.user.id } });
  const value = (type, channel) => {
    const row = rows.find((r) => r.type === type && r.channel === channel);
    return row ? row.enabled : true; // default-on when unset
  };

  const preferences = NOTIFIABLE_TYPES.map((type) => ({
    type,
    mandatory: false,
    channels: NOTIF_CHANNELS.map((channel) => ({ channel, enabled: value(type, channel) })),
  }));
  const mandatory = MANDATORY_TYPES.map((type) => ({
    type,
    mandatory: true,
    channels: NOTIF_CHANNELS.map((channel) => ({ channel, enabled: true })), // always on (RULE-NT-01)
  }));

  res.json({ success: true, data: { preferences: [...preferences, ...mandatory], channels: NOTIF_CHANNELS } });
});

// PUT /api/notifications/preferences — batch upsert; mandatory types can't be muted
export const updatePreferences = catchAsync(async (req, res, next) => {
  const { preferences } = req.body;

  for (const p of preferences) {
    if (MANDATORY_TYPES.includes(p.type) && p.enabled === false) {
      return next(new AppError(`"${p.type}" is mandatory and cannot be disabled (RULE-NT-01)`, 422));
    }
    if (!NOTIFIABLE_TYPES.includes(p.type) && !MANDATORY_TYPES.includes(p.type)) {
      return next(new AppError(`Unknown notification type "${p.type}"`, 422));
    }
  }

  await prisma.$transaction(
    preferences
      .filter((p) => !MANDATORY_TYPES.includes(p.type)) // mandatory rows are never stored as off
      .map((p) =>
        prisma.notificationPreference.upsert({
          where: { userId_type_channel: { userId: req.user.id, type: p.type, channel: p.channel } },
          update: { enabled: p.enabled },
          create: { userId: req.user.id, type: p.type, channel: p.channel, enabled: p.enabled },
        }),
      ),
  );

  res.json({ success: true, message: "Preferences updated" });
});
