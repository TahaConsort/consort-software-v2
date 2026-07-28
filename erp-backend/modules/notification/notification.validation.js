import { z } from "zod";

/**
 * Notifications — request schemas (CRM_MASTER §5.15).
 * Read-marking takes no body; preferences accept a batch of per-type/channel
 * toggles (RULE-NT-01 mandatory types are enforced in the controller).
 */

export const markReadParamsSchema = z.object({
  id: z.string().min(1),
});

export const updatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        type: z.string().min(1).max(80),
        channel: z.enum(["in_app", "email", "whatsapp"]),
        enabled: z.boolean(),
      }),
    )
    .min(1, "At least one preference is required"),
});
