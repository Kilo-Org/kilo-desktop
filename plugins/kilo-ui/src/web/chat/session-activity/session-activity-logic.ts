/** Nested under Kilo session `metadata` for every session this app creates. */
export const ANACONDA_METADATA_KEY = "anaconda";

export type AnacondaSessionMetadata = {
	workspaceId?: string;
};

type SessionStatusType = "busy" | "retry" | "idle";

export type SessionActivity = {
	directory?: string | undefined;
	workspaceId?: string | undefined;
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asStatusType = (value: unknown): SessionStatusType | undefined =>
	value === "busy" || value === "retry" || value === "idle" ? value : undefined;

export function buildAnacondaSessionMetadata(input?: { workspaceId?: string | undefined }): {
	metadata: { [ANACONDA_METADATA_KEY]: AnacondaSessionMetadata };
} {
	const anaconda: AnacondaSessionMetadata = {};
	if (input?.workspaceId) anaconda.workspaceId = input.workspaceId;
	return { metadata: { [ANACONDA_METADATA_KEY]: anaconda } };
}

export function readAnacondaSessionMetadata(
	metadata: unknown,
): AnacondaSessionMetadata | undefined {
	return asRecord(asRecord(metadata)?.[ANACONDA_METADATA_KEY]) ?? undefined;
}

/** True when this app created the session (nested `anaconda` metadata). */
export function hasAnacondaSessionMetadata(metadata: unknown): boolean {
	return readAnacondaSessionMetadata(metadata) !== undefined;
}

export function readWorkspaceIdFromMetadata(metadata: unknown): string | undefined {
	return asString(readAnacondaSessionMetadata(metadata)?.workspaceId);
}

export type SessionActivityPatch = Partial<
	Pick<SessionActivity, "directory" | "workspaceId" | "createdAt" | "updatedAt">
>;

/** Reads directory/timestamps/workspace id off a Kilo `Session` (`session.updated` info, list rows). */
export function readSessionInfoPatch(info: Record<string, unknown>): SessionActivityPatch {
	const patch: SessionActivityPatch = {};
	const directory = asString(info.directory);
	if (directory) patch.directory = directory;
	const time = asRecord(info.time);
	const createdAt = asFiniteNumber(time?.created);
	if (createdAt !== undefined) patch.createdAt = createdAt;
	const updatedAt = asFiniteNumber(time?.updated);
	if (updatedAt !== undefined) patch.updatedAt = updatedAt;
	const workspaceId = readWorkspaceIdFromMetadata(info.metadata);
	if (workspaceId) patch.workspaceId = workspaceId;
	return patch;
}

/** Merges defined patch fields into the session; returns null when nothing changed. */
export function applySessionPatch(
	session: SessionActivity,
	patch: SessionActivityPatch,
): SessionActivity | null {
	let next = session;
	for (const key of ["directory", "workspaceId", "createdAt", "updatedAt"] as const) {
		const value = patch[key];
		if (value !== undefined && next[key] !== value) {
			next = { ...next, [key]: value };
		}
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
): SessionActivity | null {
	const status = asStatusType(statusType);
	if (!status) return null;

	const wasWorking = isWorkingStatus(session?.status);

	if (status === "idle") {
		// Reconcile a stale local working state without inventing a completion time.
		if (!session || !wasWorking) return null;
		return { ...session, status: "idle", workingSince: undefined };
	}

	if (session && session.status === status && wasWorking) return null;
	const base = session ?? createEmptySessionActivity();
	// Sessions already busy at hydration count from app load — the true
	// start time is only observable via the event stream.
	return {
		...base,
		status,
		workingSince: wasWorking ? base.workingSince : now,
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
		if (existing && existing.status === status && existing.workingSince === workingSince) {
			return null;
		}
		const base = existing ?? createEmptySessionActivity();
		return {
			...state,
			sessions: { ...state.sessions, [sessionId]: { ...base, status, workingSince } },
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

/** Workspace name by stamped id, falling back to the directory basename. */
export function resolveSessionLocationLabel(
	activity: SessionActivity | undefined,
	workspaces: readonly { id: string; name: string }[],
): string {
	const workspaceId = activity?.workspaceId;
	if (workspaceId) {
		const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
		if (workspace) return workspace.name;
	}
	const directory = activity?.directory;
	if (directory) return directoryBasename(directory);
	return "Session";
}

type SidebarThreadEntry = {
	id: string;
	remoteId?: string | undefined;
	sourceIndex?: number | undefined;
};

/**
 * Splits the regular/archived lists into sidebar sections. Attention spans both
 * lists (a settled session that raises a permission/question resurfaces at the
 * top). Sessions keep static creation order; settled sorts by when work last
 * touched the session.
 */
export function partitionSidebarThreads(args: {
	regular: readonly SidebarThreadEntry[];
	archived: readonly SidebarThreadEntry[];
	activityBySessionId: Readonly<Record<string, SessionActivity>>;
}): {
	attention: { index: number; archived: boolean }[];
	sessions: number[];
	settled: number[];
} {
	const attention: { index: number; archived: boolean; updatedAt: number }[] = [];
	const sessions: { index: number; createdAt: number }[] = [];
	const settled: { index: number; updatedAt: number }[] = [];

	args.regular.forEach((entry, position) => {
		const index = entry.sourceIndex ?? position;
		const activity = entry.remoteId ? args.activityBySessionId[entry.remoteId] : undefined;
		if (needsAttention(activity)) {
			attention.push({ index, archived: false, updatedAt: activity?.updatedAt ?? 0 });
		} else {
			sessions.push({ index, createdAt: activity?.createdAt ?? 0 });
		}
	});

	args.archived.forEach((entry, position) => {
		const index = entry.sourceIndex ?? position;
		const activity = entry.remoteId ? args.activityBySessionId[entry.remoteId] : undefined;
		if (needsAttention(activity)) {
			attention.push({ index, archived: true, updatedAt: activity?.updatedAt ?? 0 });
		} else {
			settled.push({ index, updatedAt: activity?.updatedAt ?? 0 });
		}
	});

	attention.sort((a, b) => b.updatedAt - a.updatedAt || a.index - b.index);
	sessions.sort((a, b) => b.createdAt - a.createdAt || a.index - b.index);
	settled.sort((a, b) => b.updatedAt - a.updatedAt || a.index - b.index);

	return {
		attention: attention.map(({ index, archived }) => ({ index, archived })),
		sessions: sessions.map(({ index }) => index),
		settled: settled.map(({ index }) => index),
	};
}
