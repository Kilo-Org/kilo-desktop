import type { KiloSessionPreparation } from "../../../contracts/chat/schemas.js";

/** Nested under Kilo session `metadata` for every session this app creates. */
export const KILO_DESKTOP_METADATA_KEY = "kilo-desktop";
const PRE_RENAME_METADATA_KEY = "anaconda";

export type KiloDesktopWorkspaceFolder = KiloSessionPreparation["workspaceFolders"][number];

export type KiloDesktopSessionMetadata = {
	workspaceId?: string;
	workspaceFolders?: KiloDesktopWorkspaceFolder[];
	/** Present when the session runs in a Kilo-created git worktree. */
	worktree?: { branch: string };
};

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
	pendingPermissionIds: readonly string[];
	pendingQuestionIds: readonly string[];
};

export type SessionActivityState = {
	sessions: Readonly<Record<string, SessionActivity>>;
	lastVisitedAtBySessionId: Readonly<Record<string, number>>;
	openSessionId: string | null;
};

export const EMPTY_SESSION_ACTIVITY_STATE: SessionActivityState = {
	sessions: {},
	lastVisitedAtBySessionId: {},
	openSessionId: null,
};

/** Minimal shape of a normalized Kilo SSE event the store reacts to. */
export type SessionActivityEvent = {
	type: string;
	sessionId?: string | undefined;
	properties: Record<string, unknown>;
};

export function createEmptySessionActivity(): SessionActivity {
	return { pendingPermissionIds: [], pendingQuestionIds: [] };
}

export const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asStatusType = (value: unknown): SessionStatusType | undefined =>
	value === "busy" || value === "retry" || value === "idle" ? value : undefined;

export function buildKiloDesktopSessionMetadata(input?: {
	workspaceId?: string | undefined;
	workspaceFolders?: KiloDesktopWorkspaceFolder[] | undefined;
	worktreeBranch?: string | undefined;
}): {
	metadata: { [KILO_DESKTOP_METADATA_KEY]: KiloDesktopSessionMetadata };
} {
	const kiloDesktop: KiloDesktopSessionMetadata = {};
	if (input?.workspaceId) kiloDesktop.workspaceId = input.workspaceId;
	if (input?.workspaceFolders?.length) kiloDesktop.workspaceFolders = input.workspaceFolders;
	if (input?.worktreeBranch) kiloDesktop.worktree = { branch: input.worktreeBranch };
	return { metadata: { [KILO_DESKTOP_METADATA_KEY]: kiloDesktop } };
}

export function readKiloDesktopSessionMetadata(
	metadata: unknown,
): KiloDesktopSessionMetadata | undefined {
	const record = asRecord(metadata);
	if (!record) return undefined;
	return (
		asRecord(record[KILO_DESKTOP_METADATA_KEY]) ??
		asRecord(record[PRE_RENAME_METADATA_KEY]) ??
		undefined
	);
}

/** True when this app created the session. */
export function hasKiloDesktopSessionMetadata(metadata: unknown): boolean {
	return readKiloDesktopSessionMetadata(metadata) !== undefined;
}

export function readWorkspaceIdFromMetadata(metadata: unknown): string | undefined {
	return asString(readKiloDesktopSessionMetadata(metadata)?.workspaceId);
}

export function readWorkspaceFoldersFromMetadata(metadata: unknown): KiloDesktopWorkspaceFolder[] {
	const folders = readKiloDesktopSessionMetadata(metadata)?.workspaceFolders;
	if (!Array.isArray(folders)) return [];
	return folders.flatMap((folder) => {
		const record = asRecord(folder);
		const folderPath = asString(record?.path);
		if (!folderPath || typeof record?.isPrimary !== "boolean") return [];
		return [{ path: folderPath, isPrimary: record.isPrimary }];
	});
}

export function readWorktreeBranchFromMetadata(metadata: unknown): string | undefined {
	return asString(asRecord(readKiloDesktopSessionMetadata(metadata)?.worktree)?.branch);
}

export type SessionActivityPatch = Partial<
	Pick<SessionActivity, "parentId" | "directory" | "createdAt" | "updatedAt">
> & {
	/** `null` clears a previously stamped workspace (deleted workspace). */
	workspaceId?: string | null;
	/** `null` clears a previously stamped worktree branch (non-worktree session). */
	worktreeBranch?: string | null;
};

/** Reads directory/timestamps/workspace id off a Kilo `Session` (`session.updated` info, list rows). */
export function readSessionInfoPatch(info: Record<string, unknown>): SessionActivityPatch {
	const patch: SessionActivityPatch = {};
	const parentId = asString(info.parentID);
	if (parentId) patch.parentId = parentId;
	const directory = asString(info.directory);
	if (directory) patch.directory = directory;
	const time = asRecord(info.time);
	const createdAt = asFiniteNumber(time?.created);
	if (createdAt !== undefined) patch.createdAt = createdAt;
	const updatedAt = asFiniteNumber(time?.updated);
	if (updatedAt !== undefined) patch.updatedAt = updatedAt;
	if (info.metadata != null) {
		patch.workspaceId = readWorkspaceIdFromMetadata(info.metadata) ?? null;
		patch.worktreeBranch = readWorktreeBranchFromMetadata(info.metadata) ?? null;
	}
	return patch;
}

/** Merges defined patch fields into the session; returns null when nothing changed. */
export function applySessionPatch(
	session: SessionActivity,
	patch: SessionActivityPatch,
): SessionActivity | null {
	let next = session;
	for (const key of ["parentId", "directory", "createdAt", "updatedAt"] as const) {
		const value = patch[key];
		if (value !== undefined && next[key] !== value) {
			next = { ...next, [key]: value };
		}
	}
	if (patch.workspaceId === null) {
		if (next.workspaceId !== undefined) {
			const { workspaceId: _workspaceId, ...rest } = next;
			next = rest;
		}
	} else if (patch.workspaceId !== undefined && next.workspaceId !== patch.workspaceId) {
		next = { ...next, workspaceId: patch.workspaceId };
	}
	if (patch.worktreeBranch === null) {
		if (next.worktreeBranch !== undefined) {
			const { worktreeBranch: _worktreeBranch, ...rest } = next;
			next = rest;
		}
	} else if (patch.worktreeBranch !== undefined && next.worktreeBranch !== patch.worktreeBranch) {
		next = { ...next, worktreeBranch: patch.worktreeBranch };
	}
	return next === session ? null : next;
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

type PendingKey = "pendingPermissionIds" | "pendingQuestionIds";

const unionIds = (base: readonly string[], extra: readonly string[]): readonly string[] => {
	if (extra.every((id) => base.includes(id))) return base;
	return [...new Set([...base, ...extra])];
};

const rolledUpCache = new WeakMap<
	Readonly<Record<string, SessionActivity>>,
	Readonly<Record<string, SessionActivity>>
>();

/**
 * Copies every subagent session's pending prompt ids onto each ancestor, so a
 * chat row needs attention while any of its subagents waits on the user.
 * Memoized per `sessions` object so store selectors return stable records.
 */
export function withDescendantPrompts(
	sessions: Readonly<Record<string, SessionActivity>>,
): Readonly<Record<string, SessionActivity>> {
	const cached = rolledUpCache.get(sessions);
	if (cached) return cached;
	let result: Record<string, SessionActivity> | undefined;
	for (const [sessionId, activity] of Object.entries(sessions)) {
		if (!activity.parentId || !needsAttention(activity)) continue;
		const seen = new Set([sessionId]);
		for (
			let parentId: string | undefined = activity.parentId;
			parentId && !seen.has(parentId);
			parentId = sessions[parentId]?.parentId
		) {
			seen.add(parentId);
			result ??= { ...sessions };
			const parent = result[parentId] ?? createEmptySessionActivity();
			result[parentId] = {
				...parent,
				pendingPermissionIds: unionIds(parent.pendingPermissionIds, activity.pendingPermissionIds),
				pendingQuestionIds: unionIds(parent.pendingQuestionIds, activity.pendingQuestionIds),
			};
		}
	}
	const rolledUp = result ?? sessions;
	rolledUpCache.set(sessions, rolledUp);
	return rolledUp;
}

/**
 * For each prompting session, the topmost known ancestor with no parent link
 * yet: the next hop to look up. Starting from that ancestor rather than the
 * prompting session covers a nested subagent whose own link arrived live while
 * an intermediate ancestor predates the connection.
 */
export function sessionsAwaitingParentLookup(
	sessions: Readonly<Record<string, SessionActivity>>,
): string[] {
	const pending = new Set<string>();
	for (const [sessionId, activity] of Object.entries(sessions)) {
		if (!needsAttention(activity)) continue;
		const seen = new Set([sessionId]);
		let topmost: string | undefined = sessionId;
		for (let parentId = activity.parentId; parentId; parentId = sessions[parentId]?.parentId) {
			if (seen.has(parentId)) {
				topmost = undefined;
				break;
			}
			seen.add(parentId);
			topmost = parentId;
		}
		if (topmost) pending.add(topmost);
	}
	return [...pending];
}

function addPendingId(
	state: SessionActivityState,
	sessionId: string,
	key: PendingKey,
	id: string | undefined,
): SessionActivityState | null {
	if (!id) return null;
	const existing = state.sessions[sessionId];
	if (existing?.[key].includes(id)) return null;
	const base = existing ?? createEmptySessionActivity();
	return {
		...state,
		sessions: { ...state.sessions, [sessionId]: { ...base, [key]: [...base[key], id] } },
	};
}

function removePendingId(
	state: SessionActivityState,
	sessionId: string,
	key: PendingKey,
	id: string | undefined,
): SessionActivityState | null {
	if (!id) return null;
	const existing = state.sessions[sessionId];
	if (!existing || !existing[key].includes(id)) return null;
	return {
		...state,
		sessions: {
			...state.sessions,
			[sessionId]: { ...existing, [key]: existing[key].filter((pendingId) => pendingId !== id) },
		},
	};
}

/**
 * Applies a status from startup/reconnect hydration without stamping `completedAt`
 * (the finish time was not observed while disconnected).
 */
export function applyHydratedSessionStatus(
	session: SessionActivity | undefined,
	statusType: string,
	now: number,
	options?: { skipBusyIfCompleted?: boolean },
): SessionActivity | null {
	const status = asStatusType(statusType);
	if (!status) return null;

	const wasWorking = isWorkingStatus(session?.status);

	if (status === "idle") {
		// Reconcile a stale local working state without inventing a completion time.
		if (!session || !wasWorking) return null;
		return { ...session, status: "idle", workingSince: undefined };
	}

	// When a live completion raced this hydrate, keep the observed idle/done state.
	// Clean reconnects omit the flag so a later genuine busy turn can hydrate.
	if (options?.skipBusyIfCompleted && session?.completedAt !== undefined && !wasWorking) {
		return null;
	}

	if (session && session.status === status && wasWorking) return null;
	const base = session ?? createEmptySessionActivity();
	// Sessions already busy at hydration count from app load — the true
	// start time is only observable via the event stream.
	return {
		...base,
		status,
		workingSince: wasWorking ? base.workingSince : now,
		completedAt: undefined,
	};
}

function applySessionStatus(
	state: SessionActivityState,
	sessionId: string,
	status: SessionStatusType,
	now: number,
): SessionActivityState | null {
	const existing = state.sessions[sessionId];
	const wasWorking = isWorkingStatus(existing?.status);

	if (status !== "idle") {
		// workingSince survives busy<->retry flips; only the idle->working edge stamps it.
		const workingSince = wasWorking ? existing?.workingSince : now;
		if (
			existing &&
			existing.status === status &&
			existing.workingSince === workingSince &&
			existing.completedAt === undefined
		) {
			return null;
		}
		const base = existing ?? createEmptySessionActivity();
		return {
			...state,
			sessions: {
				...state.sessions,
				[sessionId]: { ...base, status, workingSince, completedAt: undefined },
			},
		};
	}

	if (!existing) return null;
	if (!wasWorking) {
		if (existing.status === "idle") return null;
		return {
			...state,
			sessions: { ...state.sessions, [sessionId]: { ...existing, status: "idle" } },
		};
	}

	let next: SessionActivityState = {
		...state,
		sessions: {
			...state.sessions,
			[sessionId]: { ...existing, status: "idle", workingSince: undefined, completedAt: now },
		},
	};
	// A completion landing on the open thread is already seen — keep it read.
	if (state.openSessionId === sessionId) {
		next = {
			...next,
			lastVisitedAtBySessionId: { ...next.lastVisitedAtBySessionId, [sessionId]: now },
		};
	}
	return next;
}

/**
 * Maps one normalized SSE event to a state transition.
 * Returns null for irrelevant events and no-ops so the store can skip notifying.
 */
export function applySessionActivityEvent(
	state: SessionActivityState,
	event: SessionActivityEvent,
	now: number,
): SessionActivityState | null {
	const properties = event.properties;
	const eventSessionId = asString(properties.sessionID) ?? event.sessionId;

	switch (event.type) {
		case "permission.asked":
		case "permission.v2.asked":
			return eventSessionId
				? addPendingId(state, eventSessionId, "pendingPermissionIds", asString(properties.id))
				: null;
		case "permission.replied":
		case "permission.v2.replied":
			return eventSessionId
				? removePendingId(
						state,
						eventSessionId,
						"pendingPermissionIds",
						asString(properties.requestID),
					)
				: null;
		case "question.asked":
		case "question.v2.asked":
			return eventSessionId
				? addPendingId(state, eventSessionId, "pendingQuestionIds", asString(properties.id))
				: null;
		case "question.replied":
		case "question.v2.replied":
		case "question.rejected":
		case "question.v2.rejected":
			return eventSessionId
				? removePendingId(
						state,
						eventSessionId,
						"pendingQuestionIds",
						asString(properties.requestID),
					)
				: null;
		case "session.status": {
			if (!eventSessionId) return null;
			const statusType = asStatusType(asRecord(properties.status)?.type);
			return statusType ? applySessionStatus(state, eventSessionId, statusType, now) : null;
		}
		case "session.idle":
			return eventSessionId ? applySessionStatus(state, eventSessionId, "idle", now) : null;
		case "session.created":
		case "session.updated": {
			const info = asRecord(properties.info);
			const sessionId = eventSessionId ?? asString(info?.id);
			if (!info || !sessionId) return null;
			const merged = applySessionPatch(
				state.sessions[sessionId] ?? createEmptySessionActivity(),
				readSessionInfoPatch(info),
			);
			if (!merged) return null;
			return { ...state, sessions: { ...state.sessions, [sessionId]: merged } };
		}
		case "session.deleted": {
			const sessionId = eventSessionId ?? asString(asRecord(properties.info)?.id);
			if (!sessionId || !(sessionId in state.sessions)) return null;
			const sessions = { ...state.sessions };
			delete sessions[sessionId];
			return { ...state, sessions };
		}
		default:
			return null;
	}
}

export type SessionRowState = "approval" | "input" | "working" | "done" | null;

/**
 * The delete dialog's orphan criterion: `sessionId` runs in a worktree
 * (a `worktreeBranch` stamp with its directory) and no other known session
 * shares that directory. An unknown or unstamped session is not a worktree
 * session as far as this predicate knows — callers that must not mistake
 * "not hydrated yet" for "not a worktree" wait for the refresh first.
 */
export function isOrphanedWorktreeSession(
	sessions: Readonly<Record<string, SessionActivity>>,
	sessionId: string,
): boolean {
	const own = sessions[sessionId];
	const directory = own?.worktreeBranch !== undefined ? own.directory : undefined;
	if (directory === undefined) return false;
	return Object.values(sessions).every((other) => other === own || other.directory !== directory);
}

/** What a chat allows: chats waiting on the user count as live even when archived. */
export function sessionRowCapabilities(archived: boolean, rowState: SessionRowState) {
	const isArchived = archived && rowState !== "approval" && rowState !== "input";
	return {
		isArchived,
		canArchive: !isArchived && (rowState === null || rowState === "done"),
		canPin: !isArchived,
	};
}

/** Git status target shared by sessions in the same workspace checkout or worktree. */
export function sessionGitStatusId(activity: SessionActivity | undefined): string | null {
	if (!activity?.workspaceId) return null;
	return activity.worktreeBranch
		? `${activity.workspaceId}:worktree:${activity.worktreeBranch}`
		: `${activity.workspaceId}:local`;
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
