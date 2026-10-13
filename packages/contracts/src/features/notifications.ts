import { z } from "zod";

import { defineMethod } from "../contract.js";

export const notificationTypeSchema = z.enum(["info", "success", "warning", "error"]);

/**
 * Delivery envelope shared by every notification method. Delivery is
 * best-effort: `delivered: false` + `reason` reports expected capability
 * absence (unsupported platform, permission denied) instead of throwing.
 */
export const notificationResultSchema = z.object({
	delivered: z.boolean(),
	reason: z.string().optional(),
});

export type NotificationDeliveryResult = z.infer<typeof notificationResultSchema>;

export const notificationsMethods = {
	"notifications:show": defineMethod(
		z.object({
			title: z.string().min(1),
			message: z.string(),
			type: notificationTypeSchema,
			/** Mute the OS sound, for callers that play their own cue. */
			silent: z.boolean().optional(),
		}),
		notificationResultSchema,
	),
	"notifications:set-badge": defineMethod(
		z.object({ count: z.number().int().nonnegative() }),
		notificationResultSchema,
	),
} as const;
