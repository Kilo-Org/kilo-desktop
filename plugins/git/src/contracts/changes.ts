/** The Changes pane kind: one per work session, showing its folders' uncommitted changes. */
export const CHANGES_PANE_KIND = "kilo.git/changes";

/** Pane metadata an opener of the Changes pane may set. */
export const CHANGES_PANE_METADATA = {
	/** One of the work session's folders to show. */
	workspaceDirectory: "workspaceDirectory",
	/** Changed file (relative to that folder) to select and scroll to. */
	revealPath: "revealPath",
	/** Unique per open request, so opening again re-applies the folder and file. */
	revealRequest: "revealRequest",
} as const;

/** The agent tool that shows the calling chat's Changes pane (origin's id, kept for its wire name). */
export const CHANGES_OPEN_TOOL_ID = "changes_open";

/** kilo.git's commands, by key. */
export const GIT_COMMANDS = {
	openChanges: "kilo.git/open-changes",
	commit: "kilo.git/commit",
	push: "kilo.git/push",
	createPullRequest: "kilo.git/create-pull-request",
} as const;

/** The telemetry events kilo.git declares (`kernel/telemetry-event` ids). */
export const GIT_TELEMETRY_EVENTS = {
	commitMessageGenerated: "commit-message-generated",
	pullRequestContentGenerated: "pull-request-content-generated",
} as const;
