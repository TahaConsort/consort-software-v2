import express from "express";
import {
  listChannels,
  getMessages,
  sendMessage,
  markRead,
  editChatMessage,
  deleteChatMessage,
  listColleagues,
  openDirectChannel,
} from "./chat.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireChatAccess } from "./chat.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { sendMessageSchema, markReadSchema, editMessageSchema, openDirectSchema } from "./chat.validation.js";

const router = express.Router();

router.use(protect, requireChatAccess);

router.get("/channels", requirePermission("chat.read"), listChannels);
router.get("/colleagues", requirePermission("chat.read"), listColleagues);
router.post("/direct", requirePermission("chat.send"), validate(openDirectSchema), openDirectChannel);

router.get("/channels/:id/messages", requirePermission("chat.read"), getMessages);
router.post("/channels/:id/messages", requirePermission("chat.send"), validate(sendMessageSchema), sendMessage);
router.post("/channels/:id/read", requirePermission("chat.read"), validate(markReadSchema), markRead);

router.patch("/messages/:messageId", requirePermission("chat.send"), validate(editMessageSchema), editChatMessage);
router.delete("/messages/:messageId", requirePermission("chat.send"), deleteChatMessage);

export default router;
