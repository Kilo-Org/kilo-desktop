import { z } from "zod";

import { defineContract, defineEvent, defineMethod } from "../contract.js";

// ─── Status schema ──────────────────────────────────────────────────────────────

export const anacondaMcpStatusSchema = z.discriminatedUnion("state", [
	z.object({ state: z.literal("disabled") }),
	z.object({ state: z.literal("waiting-for-auth") }),
	z.object({ state: z.literal("waiting-for-kilo") }),
	z.object({ state: z.literal("connected"), url: z.string().url() }),
	z.object({ state: z.literal("error"), reason: z.string() }),
]);

export type AnacondaMcpStatus = z.infer<typeof anacondaMcpStatusSchema>;

// ─── Settings schema ────────────────────────────────────────────────────────────

export const anacondaMcpSettingsSchema = z.object({
	enabled: z.boolean(),
	urlOverride: z.string().url().nullable(),
});

export type AnacondaMcpSettings = z.infer<typeof anacondaMcpSettingsSchema>;

// ─── Contract ───────────────────────────────────────────────────────────────────

export const anacondaMcpContract = defineContract({
	"status.get": defineMethod(z.undefined(), anacondaMcpStatusSchema),
	"settings.get": defineMethod(z.undefined(), anacondaMcpSettingsSchema),
	"settings.set": defineMethod(
		z.object({
			enabled: z.boolean().optional(),
			urlOverride: z.string().url().nullable().optional(),
		}),
		z.object({ ok: z.literal(true) }),
	),
});

// ─── Events ─────────────────────────────────────────────────────────────────────

export const anacondaMcpEvents = {
	"anaconda-mcp:status-changed": defineEvent(anacondaMcpStatusSchema),
} as const;
