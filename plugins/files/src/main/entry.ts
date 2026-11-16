import {
	definePlugin,
	environmentReady,
	KernelError,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Panes, Vcs, Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";

import { Documents } from "../contracts";
import type { ExternalEditorId } from "../contracts/models";
import { basename, FILE_OBJECT_TYPE, FILES_PANE_KIND } from "../contracts/panes";
import { ExternalEditorService } from "./external-editors";
import { FilesService } from "./files-service";
import { createGitStatusLookup } from "./git-status";
import { implementOpenTool } from "./open-tool";
import { foldersOfWorkSession } from "./session-folders";

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
 * kilo.work-sessions' workspaces are absent.
 */
function authorizeFolder(sdk: PluginSdk) {
	return async (canonicalWorkspaceDirectory: string): Promise<void> => {
		const workspaces = sdk.domainObjects.get(Workspaces);
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
		sdk.domainObjects.track(Panes, {
			added: (panes) => {
				stop = panes.on("opened", ({ workSessionId, pane }) => {
					if (pane.kind !== FILES_PANE_KIND || pane.object?.type !== FILE_OBJECT_TYPE) return;
					const name = basename(pane.object.id);
					void panes.methods
						.update({ workSessionId, paneId: pane.id, title: name, iconKey: name })
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
 * re-authorizes its folder with `kilo.work-sessions/workspaces` and keeps
 * file targets inside it after resolving symlinks; tree decorations come
 * from `kilo.work-sessions/vcs`. The `open` agent tool shows a file of the
 * calling chat's work session through kilo.work-sessions' openers, and file
 * panes any opener creates are titled with their file's name.
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

			sdk.domainObjects.provide(Documents, {
				initialState: {},
				methods: {
					list: ({ workspaceDirectory }) => service.list(workspaceDirectory),
					listFiles: ({ workspaceDirectory }) => service.listFiles(workspaceDirectory),
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
					// Editors are found on PATH, so both wait for the complete environment.
					listExternalEditors: async () => {
						await environmentReady(sdk);
						return { editors: [...(await editorLauncher.listAvailable())] };
					},
					openExternalEditor: async ({ workspaceDirectory, relativePath, editor }) => {
						await environmentReady(sdk);
						const targetPath = await service.resolveFilePath(workspaceDirectory, relativePath);
						await editorLauncher.open(editor, targetPath);
						return { opened: true as const };
					},
				},
			});

			implementOpenTool(sdk, {
				foldersOf: (workSessionId) => foldersOfWorkSession(sdk, workSessionId),
				existingPaths: (workspaceDirectory, relativePaths) =>
					service.existingPaths(workspaceDirectory, relativePaths),
			});
			nameOpenedFilePanes(sdk);
		},
	});
}
