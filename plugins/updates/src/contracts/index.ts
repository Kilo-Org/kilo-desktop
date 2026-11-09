import type { ComponentType } from "react";
import { z } from "zod";

import {
	defineDomain,
	defineExtensionPoint,
	implementation,
	method,
	type PluginDefinitions,
} from "@kilo-desktop/kernel";

/**
 * kilo.updates' public surface: the About → Support rows other plugins add,
 * and the typed shape of `kernel/updater` state it presents.
 */
export const UPDATES_PLUGIN_ID = "kilo.updates";

/**
 * kilo.flags' context key for the flag that lets people switch between the
 * stable and preview update tracks (`kilo.flags/flag:<flag>`).
 */
export const UPDATE_TRACK_SWITCHER_KEY = "kilo.flags/flag:update-track-switcher";

/** A row in About → Support, such as where a config file lives. */
export const SupportRow = defineExtensionPoint({
	id: "kilo.updates/support-row",
	kind: "additive",
	description: "A row in About → Support with information to include when contacting support.",
	implementation: implementation<ComponentType>("renderer"),
});

export const releaseTrackSchema = z.enum(["stable", "preview"]);

export const releaseNotesSchema = z.object({
	schemaVersion: z.literal(1),
	track: releaseTrackSchema,
	version: z.string().min(1),
	previousVersion: z.string().min(1).nullable().optional(),
	title: z.string().min(1),
	publishedAt: z.string().min(1),
	bodyMarkdown: z.string(),
	items: z.array(z.string().min(1)),
});

/** `kernel/updater` state as the desktop updater publishes it. */
export const updateStateSchema = z.object({
	enabled: z.boolean(),
	status: z.enum([
		"disabled",
		"idle",
		"checking",
		"downloading",
		"downloaded",
		"up-to-date",
		"error",
	]),
	track: releaseTrackSchema,
	currentVersion: z.string().min(1),
	availableVersion: z.string().nullable(),
	downloadedVersion: z.string().nullable(),
	releaseNotes: z.array(releaseNotesSchema),
	checkedAt: z.string().nullable(),
	message: z.string().nullable(),
});

export type ReleaseTrack = z.output<typeof releaseTrackSchema>;
export type ReleaseNotes = z.output<typeof releaseNotesSchema>;
export type UpdateState = z.output<typeof updateStateSchema>;
export interface UpdateActionResult {
	readonly accepted: boolean;
	readonly state: UpdateState;
}

export const readableLegalDocumentSchema = z.enum(["third-party-notices"]);
export const legalDocumentSchema = z.enum([
	...readableLegalDocumentSchema.options,
	"chromium-notices",
]);
export type LegalDocument = z.output<typeof legalDocumentSchema>;

/**
 * The legal documents packaging writes beside app.asar: the third-party
 * notices and Chromium's credits (HTML, so only located).
 * Every method answers `null` where a document is not shipped (development).
 */
export const Legal = defineDomain({
	id: "kilo.updates/legal",
	home: "main",
	state: z.object({}),
	methods: {
		/** The document's path, for revealing it in the file manager. */
		locate: method(z.object({ document: legalDocumentSchema }), z.string().nullable()),
		read: method(z.object({ document: readableLegalDocumentSchema }), z.string().nullable()),
	},
});

export const UPDATES_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [SupportRow],
	domains: [Legal],
};
