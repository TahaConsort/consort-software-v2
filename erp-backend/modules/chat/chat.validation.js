import { z } from "zod";

/** Internal Chat — request schemas (RULE-CH-02: idempotent client message id). */

export const sendMessageSchema = z.object({
  clientMessageId: z.string().min(1, "clientMessageId is required (idempotent sends)"),
  body: z.string().min(1, "Message body is required").max(4000),
  replyToId: z.string().optional(),
});

export const markReadSchema = z.object({
  lastReadMessageId: z.string().min(1, "lastReadMessageId is required"),
});

export const editMessageSchema = z.object({
  body: z.string().min(1, "Message body is required").max(4000),
});

export const openDirectSchema = z.object({
  userId: z.string().min(1, "userId is required"),
});
