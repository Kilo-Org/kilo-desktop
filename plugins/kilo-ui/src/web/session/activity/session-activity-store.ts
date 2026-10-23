import { createStore } from "zustand/vanilla";

import {
	applyHydratedSessionStatus,
	applySessionActivityEvent,
	applySessionPatch,
	createEmptySessionActivity,
	EMPTY_SESSION_ACTIVITY_STATE,
	type SessionActivity,
	type SessionActivityEvent,
	type SessionActivityPatch,
	type SessionActivityState,
} from "./session-activity-logic.js";

export const LAST_VISITED_STORAGE_KEY = "kilo-ui:thread-last-visited:v1";

export type SessionSummaryInput = { id: string } & SessionActivityPatch;

export type PendingRequestInput = Iterable<{ id: string; sessionID: string }>;

export type SessionActivityStoreState = SessionActivityState & {
	/** Bumps when a live SSE event mutates activity; used to detect hydrate races. */
	activityEpoch: number;
	/**
	 * True once the runtime backend's startup/reconnect session refresh has
	 * settled (success or failure). Until then a missing session record means
	 * "not hydrated yet", not "not a worktree" — delete flows read this to
	 * decide whether to wait for certainty.
	 */
	sessionsRefreshed: boolean;
	applyEvent: (event: SessionActivityEvent) => void;
	hydrateSessions: (sessions: Iterable<SessionSummaryInput>) => void;
	hydratePendingRequests: (input: {
		permissions?: PendingRequestInput;
		questions?: PendingRequestInput;
		/** Epoch captured before the hydration fetch; when stale, merge instead of replace. */
		sinceEpoch?: number;
	}) => void;
	hydrateStatuses: (
		statuses: Readonly<Record<string, { type: string }>>,
		sinceEpoch?: number,
	) => void;
	markVisited: (sessionId: string, at?: number) => void;
	markSessionsRefreshed: () => void;
	setOpenSession: (sessionId: string | null) => void;
};

export type SessionActivityStore = ReturnType<typeof createSessionActivityStore>;

/**
 * One-shot wait for the session refresh to settle. The timeout cap bounds the
 * pathological case — a store that never wires `markSessionsRefreshed` (a
 * test double or a failed backend boot) must never hang a delete flow; the
 * cap trades a possible wrong direct delete in that case for guaranteed
 * progress.
 */
export function whenSessionsRefreshed(
	store: SessionActivityStore,
	timeoutMs = 2_000,
): Promise<void> {
	if (store.getState().sessionsRefreshed) return Promise.resolve();
	return new Promise((resolve) => {
		const unsubscribe = store.subscribe((state, previous) => {
			if (state.sessionsRefreshed && !previous.sessionsRefreshed) settle();
		});
		const timer = setTimeout(settle, timeoutMs);
		function settle(): void {
			clearTimeout(timer);
			unsubscribe();
			resolve();
		}
	});
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function resolveStorage(explicit: StorageLike | null | undefined): StorageLike | null {
	if (explicit !== undefined) return explicit;
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function loadLastVisited(storage: StorageLike | null): Record<string, number> {
	if (!storage) return {};
	try {
		const raw = storage.getItem(LAST_VISITED_STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const result: Record<string, number> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
		}
		return result;
	} catch {
		return {};
	}
}

function groupIdsBySession(requests: PendingRequestInput): Map<string, string[]> {
	const grouped = new Map<string, string[]>();
	for (const request of requests) {
		const list = grouped.get(request.sessionID);
		if (list) list.push(request.id);
		else grouped.set(request.sessionID, [request.id]);
	}
	return grouped;
}

const idsEqual = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((value, index) => value === b[index]);

/** Merge snapshot + local, omitting ids a live reply already cleared during the fetch. */
const mergePendingIds = (
	snapshot: readonly string[],
	local: readonly string[],
	cleared: ReadonlySet<string>,
): string[] => {
	const merged = new Set(local);
	for (const id of snapshot) {
		if (!cleared.has(id)) merged.add(id);
	}
	return [...merged];
};

function collectClearedIds(
	prev: SessionActivityState,
	next: SessionActivityState,
	key: "pendingPermissionIds" | "pendingQuestionIds",
	into: Set<string>,
) {
	for (const [sessionId, session] of Object.entries(prev.sessions)) {
		const nextIds = next.sessions[sessionId]?.[key] ?? [];
		for (const id of session[key]) {
			if (!nextIds.includes(id)) into.add(id);
		}
	}
}

function forgetClearedIds(
	next: SessionActivityState,
	key: "pendingPermissionIds" | "pendingQuestionIds",
	cleared: Set<string>,
) {
	for (const session of Object.values(next.sessions)) {
		for (const id of session[key]) cleared.delete(id);
	}
}

export function createSessionActivityStore(options?: {
	storage?: StorageLike | null;
	now?: () => number;
}) {
	const storage = resolveStorage(options?.storage);
	const now = options?.now ?? Date.now;
	const clearedPermissionIds = new Set<string>();
	const clearedQuestionIds = new Set<string>();

	const persistLastVisited = (lastVisitedAtBySessionId: Readonly<Record<string, number>>) => {
		if (!storage) return;
		try {
			storage.setItem(LAST_VISITED_STORAGE_KEY, JSON.stringify(lastVisitedAtBySessionId));
		} catch {
			// Storage throws in private browsing or when full; visits stay in-memory only.
		}
	};

	return createStore<SessionActivityStoreState>()((set, get) => ({
		...EMPTY_SESSION_ACTIVITY_STATE,
		activityEpoch: 0,
		sessionsRefreshed: false,
		lastVisitedAtBySessionId: loadLastVisited(storage),

		applyEvent: (event) => {
			const prev = get();
			const next = applySessionActivityEvent(prev, event, now());
			if (!next) return;
			collectClearedIds(prev, next, "pendingPermissionIds", clearedPermissionIds);
			collectClearedIds(prev, next, "pendingQuestionIds", clearedQuestionIds);
			forgetClearedIds(next, "pendingPermissionIds", clearedPermissionIds);
			forgetClearedIds(next, "pendingQuestionIds", clearedQuestionIds);
			if (next.lastVisitedAtBySessionId !== prev.lastVisitedAtBySessionId) {
				persistLastVisited(next.lastVisitedAtBySessionId);
			}
			set({ ...next, activityEpoch: prev.activityEpoch + 1 });
		},

		hydrateSessions: (summaries) => {
			set((state) => {
				let sessions: Record<string, SessionActivity> = state.sessions;
				for (const summary of summaries) {
					const merged = applySessionPatch(
						sessions[summary.id] ?? createEmptySessionActivity(),
						summary,
					);
					if (!merged) continue;
					if (sessions === state.sessions) sessions = { ...sessions };
					sessions[summary.id] = merged;
				}
				return sessions === state.sessions ? state : { ...state, sessions };
			});
		},

		hydratePendingRequests: ({ permissions, questions, sinceEpoch }) => {
			const permissionIdsBySession = permissions ? groupIdsBySession(permissions) : undefined;
			const questionIdsBySession = questions ? groupIdsBySession(questions) : undefined;
			set((state) => {
				const liveEventsDuringFetch =
					sinceEpoch !== undefined && state.activityEpoch !== sinceEpoch;
				if (!liveEventsDuringFetch) {
					clearedPermissionIds.clear();
					clearedQuestionIds.clear();
				}
				const sessionIds = new Set([
					...(permissionIdsBySession?.keys() ?? []),
					...(questionIdsBySession?.keys() ?? []),
				]);
				for (const [id, session] of Object.entries(state.sessions)) {
					if (
						(permissionIdsBySession && session.pendingPermissionIds.length > 0) ||
						(questionIdsBySession && session.pendingQuestionIds.length > 0)
					) {
						sessionIds.add(id);
					}
				}
				let sessions: Record<string, SessionActivity> = state.sessions;
				for (const sessionId of sessionIds) {
					const existing = sessions[sessionId];
					const snapshotPermissions = permissionIdsBySession
						? (permissionIdsBySession.get(sessionId) ?? [])
						: undefined;
					const snapshotQuestions = questionIdsBySession
						? (questionIdsBySession.get(sessionId) ?? [])
						: undefined;
					const pendingPermissionIds =
						snapshotPermissions === undefined
							? (existing?.pendingPermissionIds ?? [])
							: liveEventsDuringFetch
								? mergePendingIds(
										snapshotPermissions,
										existing?.pendingPermissionIds ?? [],
										clearedPermissionIds,
									)
								: snapshotPermissions;
					const pendingQuestionIds =
						snapshotQuestions === undefined
							? (existing?.pendingQuestionIds ?? [])
							: liveEventsDuringFetch
								? mergePendingIds(
										snapshotQuestions,
										existing?.pendingQuestionIds ?? [],
										clearedQuestionIds,
									)
								: snapshotQuestions;
					if (
						existing &&
						idsEqual(existing.pendingPermissionIds, pendingPermissionIds) &&
						idsEqual(existing.pendingQuestionIds, pendingQuestionIds)
					) {
						continue;
					}
					if (sessions === state.sessions) sessions = { ...sessions };
					sessions[sessionId] = {
						...(existing ?? createEmptySessionActivity()),
						pendingPermissionIds,
						pendingQuestionIds,
					};
				}
				return sessions === state.sessions ? state : { ...state, sessions };
			});
		},

		hydrateStatuses: (statuses, sinceEpoch) => {
			const timestamp = now();
			const skipBusyIfCompleted = sinceEpoch !== undefined && get().activityEpoch !== sinceEpoch;
			set((state) => {
				let sessions: Record<string, SessionActivity> = state.sessions;
				for (const [sessionId, status] of Object.entries(statuses)) {
					const next = applyHydratedSessionStatus(sessions[sessionId], status.type, timestamp, {
						skipBusyIfCompleted,
					});
					if (!next) continue;
					if (sessions === state.sessions) sessions = { ...sessions };
					sessions[sessionId] = next;
				}
				return sessions === state.sessions ? state : { ...state, sessions };
			});
		},

		markVisited: (sessionId, at) => {
			set((state) => {
				const lastVisitedAtBySessionId = {
					...state.lastVisitedAtBySessionId,
					[sessionId]: at ?? now(),
				};
				persistLastVisited(lastVisitedAtBySessionId);
				return { ...state, lastVisitedAtBySessionId };
			});
		},

		markSessionsRefreshed: () => {
			// No-op after the first settle so repeated refreshes never notify.
			set((state) => (state.sessionsRefreshed ? state : { ...state, sessionsRefreshed: true }));
		},

		setOpenSession: (sessionId) => {
			set((state) =>
				state.openSessionId === sessionId ? state : { ...state, openSessionId: sessionId },
			);
		},
	}));
}
