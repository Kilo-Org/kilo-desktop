/** The Changes pane kind: one per session, showing its folders' uncommitted changes. */
export const CHANGES_PANE_KIND = "kilo.git/changes";

/** Pane metadata an opener of the Changes pane may set (origin's tab metadata keys). */
export const CHANGES_PANE_METADATA = {
	/** One of the session's folders to show. */
	workspaceDirectory: "workspaceDirectory",
	/** Changed file (relative to that folder) to select and scroll to. */
	revealPath: "revealPath",
	/** Unique per open request, so opening again re-applies the folder and file. */
	revealRequest: "revealRequest",
} as const;

export {
	resolvePathInFolders,
	sessionFolders,
	type ResolvedSessionPath,
	type SessionFolder,
} from "@kilo-desktop/plugin-workspaces/contracts";
