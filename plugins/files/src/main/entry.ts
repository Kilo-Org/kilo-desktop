import { definePlugin, KernelError, type PluginEntry, type PluginSdk } from "@kilo-desktop/kernel";
import { Panes } from "@kilo-desktop/plugin-sessions/contracts";
import { Vcs, Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import { Documents } from "../contracts/index.js";
import type { ExternalEditorId } from "../contracts/models.js";
import {
	basename,
	FILE_OBJECT_TYPE,
	FILE_PANE_METADATA,
	FILES_PANE_KIND,
} from "../contracts/panes.js";
import { ExternalEditorService } from "./external-editors.js";
import { FilesService } from "./files-service.js";
import { createGitStatusLookup } from "./git-status.js";
import { implementOpenTool } from "./open-tool.js";
import { foldersOfSession } from "./session-folders.js";

export interface ExternalEditorLauncher {
	listAvailable(): Promise<readonly ExternalEditorId[]>;
	open(editor: ExternalEditorId, targetPath: string): Promise<void>;
}

export interface FilesMainOptions {
	/** Overrides how external editors are found and launched (tests). */
	readonly editorLauncher?: ExternalEditorLauncher;
}

/**
 * A folder may be browsed when it is a workspace folder or one of its
 * managed worktrees (rule `folder`, origin's check); fails closed while
 * kilo.workspaces is absent.
 */
function authorizeFolder(sdk: PluginSdk) {
	return async (canonicalWorkspaceDirectory: string): Promise<void> => {
		const workspaces = sdk.domains.get(Workspaces);
		if (!workspaces) {
			throw new KernelError("UNAVAILABLE", "Workspaces are unavailable.");
		}
		const { allowed } = await workspaces.methods.authorize({
			path: canonicalWorkspaceDirectory,
			rule: "folder",
		});
		if (!allowed) throw new KernelError("VALIDATION", "Workspace directory is not registered.");
	};
}

/** Titles a file pane any opener created with its file's name (openers set only the object). */
function nameOpenedFilePanes(sdk: PluginSdk): void {
	let stop: (() => void) | undefined;
	sdk.onDispose(
		sdk.domains.track(Panes, {
			added: (panes) => {
				stop = panes.on("opened", ({ sessionId, pane }) => {
					const objectId = pane.metadata[FILE_PANE_METADATA.objectId];
					if (
						pane.kind !== FILES_PANE_KIND ||
						pane.metadata[FILE_PANE_METADATA.objectType] !== FILE_OBJECT_TYPE ||
						!objectId
					) {
						return;
					}
					const name = basename(objectId);
					void panes.methods
						.update({ sessionId, paneId: pane.id, title: name, iconKey: name })
						.catch((error: unknown) => sdk.logger.warn("Could not title a file pane", error));
				});
			},
			removed: () => stop?.(),
		}),
	);
	sdk.onDispose(() => stop?.());
}

/**
 * kilo.files in main. `documents` is origin's file service: every call
 * re-authorizes its folder with kilo.workspaces and keeps file targets
 * inside it after resolving symlinks; tree decorations come from
 * `kilo.workspaces/vcs`. The `open` agent tool shows a file of the calling
 * chat's session through kilo.sessions' openers, and file panes any opener
 * creates are titled with their file's name.
 */
export function createFilesMainEntry(options: FilesMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const editorLauncher = options.editorLauncher ?? new ExternalEditorService();
			const service = new FilesService({
				authorize: authorizeFolder(sdk),
				gitStatus: createGitStatusLookup(
					() => sdk.extensions.exclusive(Vcs).winner?.implementation,
					sdk.logger,
				),
			});

			sdk.domains.provide(Documents, {
				initialState: {},
				methods: {
					list: ({ workspaceDirectory }) => service.list(workspaceDirectory),
					resolveFileLink: ({ workspaceDirectory, relativePath }) =>
						service.resolveFileLink(workspaceDirectory, relativePath),
					existingPaths: async ({ workspaceDirectory, relativePaths }) => ({
						paths: await service.existingPaths(workspaceDirectory, relativePaths),
					}),
					read: ({ workspaceDirectory, relativePath }) =>
						service.read(workspaceDirectory, relativePath),
					write: ({ workspaceDirectory, relativePath, contents, expectedRevision, force }) =>
						service.write(workspaceDirectory, relativePath, contents, expectedRevision, force),
					gitStatus: async ({ workspaceDirectory }) => {
						const entries = await service.gitStatus(workspaceDirectory);
						return entries === null ? null : { entries };
					},
					listExternalEditors: async () => ({
						editors: [...(await editorLauncher.listAvailable())],
					}),
					openExternalEditor: async ({ workspaceDirectory, relativePath, editor }) => {
						const targetPath = await service.resolveFilePath(workspaceDirectory, relativePath);
						await editorLauncher.open(editor, targetPath);
						return { opened: true as const };
					},
				},
			});

			implementOpenTool(sdk, {
				foldersOf: (sessionId) => foldersOfSession(sdk, sessionId),
				existingPaths: (workspaceDirectory, relativePaths) =>
					service.existingPaths(workspaceDirectory, relativePaths),
			});
			nameOpenedFilePanes(sdk);
		},
	});
}
