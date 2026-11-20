import type { PluginSdk } from "@kilo-desktop/kernel";

import {
	FileObjectType,
	resolvePathInFolders,
	workSessionFolders,
	WorkSessions,
	Workspaces,
	type Pane,
	type PaneImplementation,
	type WorkSessionFolder,
} from "../../contracts";

/**
 * The absolute path of the file a pane shows: its kind's `path`, else the
 * file it opened (`kilo.work-sessions/file`). A kind whose `path` throws is
 * read as showing no file, so a broken plugin can't break the tab menu.
 */
export function paneFilePath(
	pane: Pane,
	implementation: PaneImplementation | undefined,
): string | undefined {
	if (implementation?.path) {
		try {
			const path = implementation.path(pane);
			if (path) return path;
		} catch {
			return undefined;
		}
	}
	return pane.object?.type === FileObjectType.id && pane.object.id ? pane.object.id : undefined;
}

/** The folders a work session shows: its workspace's with its copy for the primary, else its directory. */
export function foldersOfWorkSession(sdk: PluginSdk, workSessionId: string): WorkSessionFolder[] {
	const workSession = sdk.domainObjects
		.get(WorkSessions)
		?.getState()
		.workSessions.find((candidate) => candidate.id === workSessionId);
	if (!workSession) return [];
	const workspace = workSession.workspaceId
		? sdk.domainObjects
				.get(Workspaces)
				?.getState()
				.workspaces.find((candidate) => candidate.id === workSession.workspaceId)
		: undefined;
	const folders = (workspace?.folders ?? []).map(({ path, isPrimary }) => ({ path, isPrimary }));
	return workSessionFolders(
		folders,
		workSession.branch || folders.length === 0 ? workSession.directory : null,
	);
}

/**
 * `absolutePath` inside the session folder holding it, with that folder's
 * separator (VS Code's "auto"); the absolute path itself outside every folder,
 * as VS Code's "Copy Relative Path" does.
 */
export function relativePanePath(
	absolutePath: string,
	folders: readonly WorkSessionFolder[],
): string {
	const resolved = resolvePathInFolders(folders, absolutePath);
	if (!resolved?.relativePath) return absolutePath;
	return resolved.workspaceDirectory.includes("\\")
		? resolved.relativePath.replaceAll("/", "\\")
		: resolved.relativePath;
}
