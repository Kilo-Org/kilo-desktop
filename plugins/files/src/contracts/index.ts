import { z } from "zod";

import { defineDomainObject, method, type PluginDefinitions } from "@kilo-desktop/kernel";

import {
	existingPathsInputSchema,
	externalEditorIdSchema,
	fileGitStatusEntrySchema,
	fileInputSchema,
	fileLinkResolutionSchema,
	fileReadResultSchema,
	filesListResultSchema,
	fileWriteResultSchema,
	listInputSchema,
	openExternalEditorInputSchema,
	writeInputSchema,
} from "./models";

export * from "./models";
export * from "./panes";

/**
 * kilo.files' public surface: the Files pane kind (`kilo.files/files`), an
 * opener for `kilo.work-sessions/file` objects, `@` file mentions, file links
 * in the agent's replies, the `open` agent tool, and `documents` — listing,
 * reading and saving files inside workspace folders, checked against
 * `kilo.work-sessions/workspaces` on every call.
 */
export const FILES_PLUGIN_ID = "kilo.files";

/** The agent tool that shows a file (origin's id, kept for its wire name `desktop_files_open`). */
export const OPEN_FILE_TOOL_ID = "open";

/** kilo.files' commands, by key (origin's ids, so saved keybindings keep working). */
export const FILES_COMMANDS = {
	open: "kilo.files/open",
} as const;

/** The telemetry events kilo.files declares (`kernel/telemetry-event` ids). */
export const FILES_TELEMETRY_EVENTS = {
	fileOpened: "file-opened",
	notebookOpened: "notebook-opened",
} as const;

/** Files inside workspace folders, read and written in main. */
export const Documents = defineDomainObject({
	id: "kilo.files/documents",
	home: "main",
	description: "Listing, reading and saving files inside workspace folders.",
	state: z.object({}),
	methods: {
		/** Every path in the folder (folders end in `/`), sorted; capped. */
		list: method(listInputSchema, filesListResultSchema),
		/**
		 * The folder's files only, skipping gitignored paths (`node_modules`,
		 * `.venv`, …) and nested worktrees, sorted; capped. What `@` mentions offer.
		 */
		listFiles: method(listInputSchema, filesListResultSchema),
		/** Finds a file a link names: exactly, or by its path's ending. */
		resolveFileLink: method(fileInputSchema, fileLinkResolutionSchema),
		/** Which of the paths are files inside the folder. */
		existingPaths: method(existingPathsInputSchema, z.object({ paths: z.array(z.string()) })),
		read: method(fileInputSchema, fileReadResultSchema),
		/** Saves text over the revision the caller read, unless `force`. */
		write: method(writeInputSchema, fileWriteResultSchema),
		/** Version control status of the folder's files; null outside a repository root. */
		gitStatus: method(
			listInputSchema,
			z.object({ entries: z.array(fileGitStatusEntrySchema) }).nullable(),
		),
		listExternalEditors: method(
			z.undefined(),
			z.object({ editors: z.array(externalEditorIdSchema) }),
		),
		openExternalEditor: method(
			openExternalEditorInputSchema,
			z.object({ opened: z.literal(true) }),
		),
	},
});

export const FILES_DEFINITIONS: PluginDefinitions = {
	domainObjects: [Documents],
};
