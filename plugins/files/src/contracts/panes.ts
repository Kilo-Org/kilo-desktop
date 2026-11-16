import {
	FileObjectType,
	resolvePathInFolders,
	type WorkSessionFolder,
} from "@kilo-desktop/plugin-work-sessions/contracts";

/**
 * The Files pane kind. A pane without a file is an explorer (the folder
 * tree); a pane with one shows that file. Several of each may be open.
 */
export const FILES_PANE_KIND = "kilo.files/files";

/** The object type file panes open: `kilo.work-sessions/file`, its id an absolute path. */
export const FILE_OBJECT_TYPE = FileObjectType.id;

/** Pane metadata keys (origin's tab keys). The file a pane opened is its `object`. */
export const FILE_PANE_METADATA = {
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

/** What `filePaneTarget` reads of a pane. */
export interface FilePaneFacts {
	readonly object?: { readonly type: string; readonly id: string } | undefined;
	readonly metadata: Readonly<Record<string, string>>;
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
 * The file a Files pane shows within the work session's folders: its opened
 * object, else origin's folder and relative path; null for an explorer or a
 * file outside the folders.
 */
export function filePaneTarget(
	pane: FilePaneFacts,
	folders: readonly WorkSessionFolder[],
): FileTarget | null {
	if (pane.object?.type === FILE_OBJECT_TYPE) {
		const resolved = resolvePathInFolders(folders, pane.object.id);
		return resolved?.relativePath ? resolved : null;
	}
	const workspaceDirectory = pane.metadata[FILE_PANE_METADATA.workspaceDirectory];
	const relativePath = pane.metadata[FILE_PANE_METADATA.relativePath];
	if (!workspaceDirectory || !relativePath) return null;
	return folders.some((folder) => folder.path === workspaceDirectory)
		? { workspaceDirectory, relativePath }
		: null;
}

/**
 * The absolute path of the file a Files pane shows: its opened object, else
 * origin's folder and relative path; undefined for an explorer.
 */
export function filePanePath(pane: FilePaneFacts): string | undefined {
	if (pane.object?.type === FILE_OBJECT_TYPE) return pane.object.id || undefined;
	const workspaceDirectory = pane.metadata[FILE_PANE_METADATA.workspaceDirectory];
	const relativePath = pane.metadata[FILE_PANE_METADATA.relativePath];
	return workspaceDirectory && relativePath
		? absoluteFilePath(workspaceDirectory, relativePath)
		: undefined;
}
