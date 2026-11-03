import type { Session } from "@kilo-desktop/plugin-sessions/contracts";

type SessionStatusType = "busy" | "retry" | "idle";

export type SessionActivity = {
	/** Set for subagent sessions; their prompts surface on the parent's row. */
	parentId?: string | undefined;
	directory?: string | undefined;
	workspaceId?: string | undefined;
	/** The session's worktree branch (`kilo/…`) when it runs in a worktree. */
	worktreeBranch?: string | undefined;
	createdAt?: number | undefined;
	updatedAt?: number | undefined;
	status?: SessionStatusType | undefined;
	workingSince?: number | undefined;
	completedAt?: number | undefined;
	/** The last turn's failure, until the next turn starts. */
	lastError?: { readonly name: string; readonly message: string } | undefined;
	pendingPermissionIds: readonly string[];
	pendingQuestionIds: readonly string[];
};

export function createEmptySessionActivity(): SessionActivity {
	return { pendingPermissionIds: [], pendingQuestionIds: [] };
}

function isWorkingStatus(status: SessionStatusType | undefined): boolean {
	return status === "busy" || status === "retry";
}

export function needsAttention(activity: SessionActivity | undefined): boolean {
	return (
		activity !== undefined &&
		(activity.pendingPermissionIds.length > 0 || activity.pendingQuestionIds.length > 0)
	);
}

export type SessionRowState = "approval" | "input" | "working" | "done" | null;

/** What a chat allows: chats waiting on the user count as live even when archived. */
export function sessionRowCapabilities(archived: boolean, rowState: SessionRowState) {
	const isArchived = archived && rowState !== "approval" && rowState !== "input";
	return {
		isArchived,
		canArchive: !isArchived && (rowState === null || rowState === "done"),
		canPin: !isArchived,
	};
}

/** Priority per session: approval > input > working > done (unread) > none. */
export function deriveSessionRowState(
	activity: SessionActivity | undefined,
	lastVisitedAt: number | undefined,
): SessionRowState {
	if (!activity) return null;
	if (activity.pendingPermissionIds.length > 0) return "approval";
	if (activity.pendingQuestionIds.length > 0) return "input";
	if (isWorkingStatus(activity.status)) return "working";
	if (
		activity.completedAt !== undefined &&
		lastVisitedAt !== undefined &&
		activity.completedAt > lastVisitedAt
	) {
		return "done";
	}
	return null;
}

export type SessionStatus = Exclude<SessionRowState, null> | "archived" | "idle";

/**
 * One status per session, as a board card shows it: live states that need
 * attention or show work outrank being archived; archived outranks unread.
 */
export function sessionStatus(archived: boolean, rowState: SessionRowState): SessionStatus {
	if (rowState === "approval" || rowState === "input" || rowState === "working") return rowState;
	if (archived) return "archived";
	return rowState ?? "idle";
}

/** Compact working-duration format: `45s`, `3m`, `1h 20m`. */
export function formatWorkingDurationLabel(elapsedMs: number): string {
	const seconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Compact relative label for row timestamps: `now`, `5m`, `3h`, `2d`, then a date. */
export function formatRelativeTimeLabel(timestampMs: number, nowMs: number): string {
	const elapsed = Math.max(0, nowMs - timestampMs);
	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	return new Date(timestampMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function directoryBasename(directory: string): string {
	const segments = directory.split(/[\\/]/).filter(Boolean);
	return segments[segments.length - 1] ?? directory;
}

/**
 * Workspace name by stamped id. Deleted workspaces fall back to the directory
 * basename. Unscoped chats have no location.
 */
export function resolveSessionLocationLabel(
	activity: SessionActivity | undefined,
	workspaces: readonly { id: string; name: string }[],
): string | null {
	const workspaceId = activity?.workspaceId;
	if (!workspaceId) return null;
	const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
	if (workspace) return workspace.name;
	const directory = activity?.directory;
	return directory ? directoryBasename(directory) : null;
}

/**
 * What a session itself knows, before its chats' activity is added: its
 * workspace, worktree, directory and times, nothing pending.
 */
export function activityOfSession(session: Session): SessionActivity {
	return {
		directory: session.directory ?? undefined,
		workspaceId: session.workspaceId ?? undefined,
		worktreeBranch: session.worktreeBranch ?? undefined,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		pendingPermissionIds: [],
		pendingQuestionIds: [],
	};
}
