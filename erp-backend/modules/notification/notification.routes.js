import express from "express";
import {
  listNotifications,
  markRead,
  markAllRead,
  getPreferences,
  updatePreferences,
} from "./notification.controllers.js";
import { protect } from "../auth/auth.middleware.js";
import { loadOwnNotification } from "./notification.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { updatePreferencesSchema } from "./notification.validation.js";

const router = express.Router();

router.use(protect); // every internal or portal user has their own feed

router.get("/", listNotifications);
router.post("/read-all", markAllRead);
router.get("/preferences", getPreferences);
router.put("/preferences", validate(updatePreferencesSchema), updatePreferences);
router.patch("/:id/read", loadOwnNotification, markRead);

export default router;
