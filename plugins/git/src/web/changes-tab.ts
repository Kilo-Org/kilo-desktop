/** Tab metadata keys a Changes tab opener may set. */
export const CHANGES_TAB_METADATA = {
	/** One of the chat's workspace folders to show. */
	workspaceDirectory: "workspaceDirectory",
	/** Changed file (relative to that folder) to select and scroll to. */
	revealPath: "revealPath",
	/** Unique per open request so re-opening re-applies the folder and file. */
	revealRequest: "revealRequest",
} as const;
