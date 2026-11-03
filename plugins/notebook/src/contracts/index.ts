import { z } from "zod";

import { defineDomain, method, type PluginDefinitions } from "@kilo-desktop/kernel";
import { Files } from "@kilo-desktop/plugin-workspaces/contracts";

export * from "./notebook-theme";

/**
 * kilo.notebook's public surface: the Notebook pane kind
 * (`kilo.notebook/notebook`, origin's `notebook.notebook` tab), the opener for
 * a workspace's `.ipynb` files, the notebook agent tools, and `notebooks` —
 * the notebook runtime (nteract's `runtimed`) and the panes' notebooks, in
 * main.
 */
export const NOTEBOOK_PLUGIN_ID = "kilo.notebook";

export const NOTEBOOK_PANE_KIND = "kilo.notebook/notebook";

/** Origin's right-panel tab definition, kilo.sessions' legacy key for the pane kind. */
export const LEGACY_NOTEBOOK_TAB_ID = "notebook.notebook";

/** kilo.workspaces' file objects (an absolute path); `.ipynb` ones open here. */
export const FILE_OBJECT_TYPE = Files.id;

/**
 * The embedded host nteract's notebook UI is served from — a sibling of the
 * app's host on the desktop scheme, so its own origin with its own CSP and
 * storage.
 */
export const NOTEBOOK_HOST = "notebook";

/** The port a pane's frame talks to its notebook through (nteract's Electron host protocol). */
export const NOTEBOOK_HOST_PORT = "host";

export const NTERACT_ELECTRON_HOST_PROTOCOL_VERSION = 1;

/** The `kernel/service` running the notebook runtime daemon. */
export const RUNTIMED_SERVICE_KEY = "kilo.notebook/runtimed";

export const NOTEBOOK_PANE_TITLE = "Notebook";

/** Pane metadata keys (origin's, so handed-over tabs keep their notebooks). */
export const NOTEBOOK_PANE_METADATA = {
	/** The daemon's id for the pane's notebook (a UUID). */
	notebookId: "notebookId",
	/** The notebook file, for a file-backed notebook. */
	notebookPath: "notebookPath",
	/** `opening` while the file opens, `ready` once it did, `error` when it couldn't. */
	openState: "notebookOpenState",
	openError: "notebookOpenError",
	/** Set by `Panes.openObject`: the file the pane was opened for. */
	objectType: "objectType",
	objectId: "objectId",
} as const;

export type NotebookOpenState = "opening" | "ready" | "error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Origin's pane ids were the notebook's UUID, once prefixed with the tab definition. */
function notebookIdOfLegacyPaneId(paneId: string): string | undefined {
	const prefix = `${LEGACY_NOTEBOOK_TAB_ID}:`;
	const id = paneId.startsWith(prefix) ? paneId.slice(prefix.length) : paneId;
	return UUID.test(id) ? id : undefined;
}

export function notebookOpenState(
	metadata: Readonly<Record<string, string>>,
): NotebookOpenState | undefined {
	const state = metadata[NOTEBOOK_PANE_METADATA.openState];
	return state === "opening" || state === "ready" || state === "error" ? state : undefined;
}

/** The file a pane's notebook comes from, when it is file-backed. */
export function notebookFileOf(pane: {
	readonly metadata: Readonly<Record<string, string>>;
}): string | undefined {
	const { metadata } = pane;
	if (metadata[NOTEBOOK_PANE_METADATA.notebookPath]) {
		return metadata[NOTEBOOK_PANE_METADATA.notebookPath];
	}
	return metadata[NOTEBOOK_PANE_METADATA.objectType] === FILE_OBJECT_TYPE
		? metadata[NOTEBOOK_PANE_METADATA.objectId] || undefined
		: undefined;
}

/** The daemon's id for a pane's notebook; undefined until main has given it one. */
export function notebookIdOf(pane: {
	readonly id: string;
	readonly metadata: Readonly<Record<string, string>>;
}): string | undefined {
	const id = pane.metadata[NOTEBOOK_PANE_METADATA.notebookId];
	if (id) return UUID.test(id) ? id : undefined;
	if (notebookOpenState(pane.metadata) || notebookFileOf(pane)) return undefined;
	return notebookIdOfLegacyPaneId(pane.id);
}

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

/**
 * `daemon` is null whenever the runtime is unreachable; `availability` keeps
 * that expected prerequisite state distinct from a failed call.
 */
export const notebookStatusSchema = z.object({
	availability: z.object({
		status: z.enum(["available", "unavailable"]),
		/** Present on `unavailable`, with an actionable runtime prerequisite. */
		reason: z.string().optional(),
	}),
	process: notebookDaemonProcessSchema,
	daemon: notebookDaemonSchema.nullable(),
});
export type NotebookStatus = z.infer<typeof notebookStatusSchema>;

export const notebookSaveResultSchema = z.object({
	outcome: z.enum(["saved", "cancelled", "failed"]),
	reason: z.string().optional(),
});
export type NotebookSaveResult = z.infer<typeof notebookSaveResultSchema>;

export interface NotebookOpenFileResult {
	readonly notebookId: string;
	readonly path: string;
	readonly title: string;
}

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

const notebookIdSchema = z.string().uuid();
const absolutePath = z.string().min(1).max(32_768);

/** What a pane's frame opens the `host` port with. */
export const notebookConnectionArgsSchema = z.object({
	notebookId: notebookIdSchema,
	sessionId: z.string().min(1).max(512),
	title: z.string().min(1).max(512),
	workingDirectory: absolutePath.optional(),
	notebookPath: absolutePath.optional(),
});
export type NotebookConnectionArgs = z.infer<typeof notebookConnectionArgsSchema>;

/**
 * The notebook runtime and the panes' notebooks. Methods that need the
 * runtime start it (`kernel/service` `runtimed`, first use). Main gives every
 * Notebook pane its notebook (a new one, or the file it was opened for) and
 * titles the pane after it; `dirty` lists connected notebooks with unsaved
 * changes, by notebook id.
 */
export const Notebooks = defineDomain({
	id: "kilo.notebook/notebooks",
	home: "main",
	state: z.object({
		settings: notebookSettingsSchema,
		dirty: z.record(z.string(), z.boolean()),
	}),
	methods: {
		status: method(z.undefined(), notebookStatusSchema),
		/** Asks the notebook to save (its UI may ask where); settles when it did or couldn't. */
		save: method(z.object({ notebookId: notebookIdSchema }), notebookSaveResultSchema),
		updateSettings: method(notebookSettingsSchema.partial(), notebookSettingsSchema),
		/**
		 * Runs once per new (untitled) notebook before it connects, so the daemon
		 * discovers the workspace environment.yml on its first kernel launch.
		 */
		prepareEnvironment: method(
			z.object({ notebookId: notebookIdSchema, workingDirectory: absolutePath }),
			notebookEnvironmentPreparationSchema,
		),
		/** Gives a pane its notebook if it has none yet (opening its file); safe to repeat. */
		resolvePane: method(
			z.object({ sessionId: z.string().min(1), paneId: z.string().min(1) }),
			z.undefined(),
		),
	},
});

export const NOTEBOOK_DEFINITIONS: PluginDefinitions = {
	domains: [Notebooks],
};
