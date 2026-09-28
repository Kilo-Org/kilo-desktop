import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

/**
 * Host the notebook bundle is served from on the desktop scheme — a sibling of
 * `app`, not a path under it, which is what makes it a separate origin with its
 * own CSP and storage (../../docs/embedding-decisions.md, D1).
 *
 * Lives in contracts because both sides need it: main serves this host, and the
 * renderer builds the iframe `src` from it.
 */
export const NOTEBOOK_HOST = "notebook";
export const NTERACT_ELECTRON_HOST_PROTOCOL_VERSION = 1;

export const notebookDaemonSchema = z.object({
	version: z.string(),
	socketPath: z.string(),
	isDevMode: z.boolean(),
	blobPort: z.number().int().positive().nullable(),
});
export type NotebookDaemon = z.infer<typeof notebookDaemonSchema>;

export const notebookDaemonProcessSchema = z.object({
	status: z.enum([
		"idle",
		"probing",
		"external",
		"starting",
		"bundled",
		"restarting",
		"failed",
		"stopped",
	]),
	pid: z.number().int().nonnegative().optional(),
	attempt: z.number().int().positive().optional(),
	reason: z.string().optional(),
});
export type NotebookDaemonProcess = z.infer<typeof notebookDaemonProcessSchema>;

export const notebookDaemonAvailabilitySchema = z.object({
	status: z.enum(["available", "unavailable"]),
	/** Present on `unavailable`, with an actionable runtime prerequisite. */
	reason: z.string().optional(),
});
export type NotebookDaemonAvailability = z.infer<typeof notebookDaemonAvailabilitySchema>;

/**
 * `daemon` is null whenever the externally installed singleton is unreachable.
 * `availability` keeps that expected prerequisite state distinct from IPC failure.
 */
export const notebookStatusSchema = z.object({
	availability: notebookDaemonAvailabilitySchema,
	process: notebookDaemonProcessSchema,
	daemon: notebookDaemonSchema.nullable(),
});
export type NotebookStatus = z.infer<typeof notebookStatusSchema>;

export const NOTEBOOK_DIRTY_CHANGED_EVENT = "notebook.dirty-changed";
export const NOTEBOOK_TITLE_CHANGED_EVENT = "notebook.title-changed";

export const notebookDirtyChangedSchema = z.object({
	notebookId: z.string().uuid(),
	sessionId: z.string().min(1),
	dirty: z.boolean(),
});
export type NotebookDirtyChanged = z.infer<typeof notebookDirtyChangedSchema>;

export const notebookTitleChangedSchema = z.object({
	notebookId: z.string().uuid(),
	sessionId: z.string().min(1),
	title: z.string().min(1),
});
export type NotebookTitleChanged = z.infer<typeof notebookTitleChangedSchema>;

export const notebookSaveResultSchema = z.object({
	outcome: z.enum(["saved", "cancelled", "failed"]),
	reason: z.string().optional(),
});
export type NotebookSaveResult = z.infer<typeof notebookSaveResultSchema>;

export const notebookOpenFileResultSchema = z.object({
	notebookId: z.string().uuid(),
	path: z.string().min(1),
	title: z.string().min(1),
});
export type NotebookOpenFileResult = z.infer<typeof notebookOpenFileResultSchema>;

export const notebookSettingsSchema = z.object({
	/** Write a workspace environment.yml for new notebooks; when off, notebooks open unchanged. */
	autoCreateEnvironmentFile: z.boolean(),
	/** Approve dependencies of notebooks created in the app so nteract's trust prompt is skipped. */
	trustNewNotebooks: z.boolean(),
});
export type NotebookSettings = z.infer<typeof notebookSettingsSchema>;

export const DEFAULT_NOTEBOOK_SETTINGS: NotebookSettings = {
	autoCreateEnvironmentFile: true,
	trustNewNotebooks: false,
};

export const notebookEnvironmentPreparationSchema = z.discriminatedUnion("outcome", [
	/** A project file already selects this notebook's environment. */
	z.object({ outcome: z.literal("existing"), path: z.string().min(1) }),
	z.object({ outcome: z.literal("created"), path: z.string().min(1) }),
	/** The workspace already has a uv environment (`uv.lock` or `.venv`). */
	z.object({ outcome: z.literal("uv"), path: z.string().min(1) }),
	/** Auto-create is off, or this notebook was prepared before without a file. */
	z.object({ outcome: z.literal("skipped") }),
	z.object({ outcome: z.literal("failed"), reason: z.string() }),
]);
export type NotebookEnvironmentPreparation = z.infer<typeof notebookEnvironmentPreparationSchema>;

export const notebookContract = defineContract({
	status: defineMethod(z.undefined(), notebookStatusSchema),
	openFile: defineMethod(z.object({ path: z.string().min(1) }), notebookOpenFileResultSchema),
	save: defineMethod(z.object({ notebookId: z.string().uuid() }), notebookSaveResultSchema),
	setDefaultSaveDirectory: defineMethod(
		z.object({ notebookId: z.string().uuid(), directory: z.string().min(1).nullable() }),
		z.undefined(),
	),
	getSettings: defineMethod(z.undefined(), notebookSettingsSchema),
	updateSettings: defineMethod(notebookSettingsSchema.partial(), notebookSettingsSchema),
	/**
	 * Runs once per new (untitled) notebook before it connects, so the daemon
	 * discovers the workspace environment.yml on its first kernel launch.
	 */
	prepareEnvironment: defineMethod(
		z.object({
			notebookId: z.string().uuid(),
			workingDirectory: z.string().min(1).max(32_768),
		}),
		notebookEnvironmentPreparationSchema,
	),
});

export type NotebookService = InferContract<typeof notebookContract>;
