import {
	Files,
	resolvePathInFolders,
	type SessionFolder,
} from "@kilo-desktop/plugin-workspaces/contracts";

/**
 * The Files pane kind. A pane without a file is an explorer (the folder
 * tree); a pane with one shows that file. Several of each may be open.
 */
export const FILES_PANE_KIND = "kilo.files/files";

/** The object type file panes open: `kilo.workspaces/file`, its id an absolute path. */
export const FILE_OBJECT_TYPE = Files.id;

/** Pane metadata keys (origin's tab keys, plus kilo.sessions' opener keys). */
export const FILE_PANE_METADATA = {
	/** Set by `Panes.openObject`: the object's type and id (the file's absolute path). */
	objectType: "objectType",
	objectId: "objectId",
	/** The folder an explorer shows; with `relativePath`, origin's file panes. */
	workspaceDirectory: "workspaceDirectory",
	relativePath: "relativePath",
	/** 1-based line and column to reveal. */
	line: "line",
	column: "column",
	/** Unique per reveal request, so revealing the same place again scrolls again. */
	revealRequest: "revealRequest",
} as const;

export interface FileTarget {
	readonly workspaceDirectory: string;
	readonly relativePath: string;
}

/** Joins a folder and a `/`-separated relative path with the folder's own separator. */
export function absoluteFilePath(workspaceDirectory: string, relativePath: string): string {
	const separator = workspaceDirectory.includes("\\") ? "\\" : "/";
	const folder = workspaceDirectory.replace(/[\\/]+$/u, "");
	const relative = relativePath.replace(/^[\\/]+/u, "");
	return `${folder}${separator}${separator === "\\" ? relative.replaceAll("/", "\\") : relative}`;
}

export function basename(path: string): string {
	return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

/**
 * The file a Files pane shows within the session's folders: its opened
 * object, else origin's folder and relative path; null for an explorer or a
 * file outside the folders.
 */
export function filePaneTarget(
	metadata: Readonly<Record<string, string>>,
	folders: readonly SessionFolder[],
): FileTarget | null {
	const objectId = metadata[FILE_PANE_METADATA.objectId];
	if (metadata[FILE_PANE_METADATA.objectType] === FILE_OBJECT_TYPE && objectId) {
		const resolved = resolvePathInFolders(folders, objectId);
		return resolved?.relativePath ? resolved : null;
	}
	const workspaceDirectory = metadata[FILE_PANE_METADATA.workspaceDirectory];
	const relativePath = metadata[FILE_PANE_METADATA.relativePath];
	if (!workspaceDirectory || !relativePath) return null;
	return folders.some((folder) => folder.path === workspaceDirectory)
		? { workspaceDirectory, relativePath }
		: null;
}
