import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";

/**
 * Notifications are strictly per-user: every route is `protect`-ed and this
 * loader guarantees a user can only touch their own rows. Out-of-scope reads
 * 404, never 403 (BUSINESS_RULES §2.3) — existence is not leaked.
 */
export const loadOwnNotification = async (req, res, next) => {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: req.params.id },
    });
    if (!notification || notification.userId !== req.user.id) {
      return next(new AppError("Notification not found", 404));
    }
    req.notification = notification;
    next();
  } catch (err) {
    next(err);
  }
};
