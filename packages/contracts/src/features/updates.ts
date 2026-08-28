import { z } from "zod";

import { defineEvent, defineMethod } from "../contract.js";

export const releaseChannels = ["canary", "staging", "prod"] as const;
export const releaseChannelSchema = z.enum(releaseChannels);

export const desktopUpdateStatusSchema = z.enum([
	"disabled",
	"idle",
	"checking",
	"downloading",
	"downloaded",
	"up-to-date",
	"error",
]);

export const desktopReleaseNotesSchema = z.object({
	schemaVersion: z.literal(1),
	channel: releaseChannelSchema,
	version: z.string().min(1),
	previousVersion: z.string().min(1).nullable().optional(),
	title: z.string().min(1),
	publishedAt: z.string().min(1),
	bodyMarkdown: z.string(),
	items: z.array(z.string().min(1)).max(50),
});

export const desktopUpdateStateSchema = z.object({
	enabled: z.boolean(),
	status: desktopUpdateStatusSchema,
	channel: releaseChannelSchema,
	currentVersion: z.string().min(1),
	availableVersion: z.string().nullable(),
	downloadedVersion: z.string().nullable(),
	releaseNotes: z.array(desktopReleaseNotesSchema).max(6),
	checkedAt: z.string().nullable(),
	message: z.string().nullable(),
});

export const desktopUpdateActionResultSchema = z.object({
	accepted: z.boolean(),
	state: desktopUpdateStateSchema,
});

export type ReleaseChannel = z.infer<typeof releaseChannelSchema>;
export type DesktopReleaseNotes = z.infer<typeof desktopReleaseNotesSchema>;
export type DesktopUpdateState = z.infer<typeof desktopUpdateStateSchema>;
export type DesktopUpdateActionResult = z.infer<typeof desktopUpdateActionResultSchema>;

export const updateMethods = {
	"updates:get-state": defineMethod(z.undefined(), desktopUpdateStateSchema),
	"updates:check": defineMethod(z.undefined(), desktopUpdateActionResultSchema),
	"updates:install": defineMethod(z.undefined(), desktopUpdateActionResultSchema),
} as const;

export const updateEvents = {
	"updates:state-changed": defineEvent(desktopUpdateStateSchema),
} as const;
