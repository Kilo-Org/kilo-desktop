import { createStore } from "zustand/vanilla";

import {
	applySessionActivityEvent,
	applySessionPatch,
	createEmptySessionActivity,
	EMPTY_SESSION_ACTIVITY_STATE,
	isWorkingStatus,
	type SessionActivity,
	type SessionActivityEvent,
	type SessionActivityState,
	type SessionStatusType,
} from "./session-activity-logic.js";

export const LAST_VISITED_STORAGE_KEY = "kilo-ui:thread-last-visited:v1";

export type SessionSummaryInput = {
	id: string;
	directory?: string | undefined;
	workspaceId?: string | undefined;
	createdAt?: number | undefined;
	updatedAt?: number | undefined;
};

export type PendingRequestInput = Iterable<{ id: string; sessionID: string }>;

export type SessionActivityStoreState = SessionActivityState & {
	applyEvent: (event: SessionActivityEvent) => void;
	hydrateSessions: (sessions: Iterable<SessionSummaryInput>) => void;
	hydratePendingRequests: (input: {
		permissions: PendingRequestInput;
		questions: PendingRequestInput;
	}) => void;
	hydrateStatuses: (statuses: Readonly<Record<string, { type: string }>>) => void;
	markVisited: (sessionId: string, at?: number) => void;
	setOpenSession: (sessionId: string | null) => void;
};

export type SessionActivityStore = ReturnType<typeof createSessionActivityStore>;

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

export function createSessionActivityStore(options?: {
	storage?: StorageLike | null;
	now?: () => number;
}) {
	const storage = resolveStorage(options?.storage);
	const now = options?.now ?? Date.now;

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
		lastVisitedAtBySessionId: loadLastVisited(storage),

		applyEvent: (event) => {
			const prev = get();
			const next = applySessionActivityEvent(prev, event, now());
			if (!next) return;
			if (next.lastVisitedAtBySessionId !== prev.lastVisitedAtBySessionId) {
				persistLastVisited(next.lastVisitedAtBySessionId);
			}
			set(next);
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

		hydratePendingRequests: ({ permissions, questions }) => {
			const permissionIdsBySession = groupIdsBySession(permissions);
			const questionIdsBySession = groupIdsBySession(questions);
			set((state) => {
				const sessionIds = new Set([
					...permissionIdsBySession.keys(),
					...questionIdsBySession.keys(),
				]);
				for (const [id, session] of Object.entries(state.sessions)) {
					if (session.pendingPermissionIds.length > 0 || session.pendingQuestionIds.length > 0) {
						sessionIds.add(id);
					}
				}
				let sessions: Record<string, SessionActivity> = state.sessions;
				for (const sessionId of sessionIds) {
					const pendingPermissionIds = permissionIdsBySession.get(sessionId) ?? [];
					const pendingQuestionIds = questionIdsBySession.get(sessionId) ?? [];
					const existing = sessions[sessionId];
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

		hydrateStatuses: (statuses) => {
			const timestamp = now();
			set((state) => {
				let sessions: Record<string, SessionActivity> = state.sessions;
				for (const [sessionId, status] of Object.entries(statuses)) {
					const type: SessionStatusType | undefined =
						status.type === "busy" || status.type === "retry" || status.type === "idle"
							? status.type
							: undefined;
					if (!type) continue;
					const existing = sessions[sessionId];
					const wasWorking = isWorkingStatus(existing?.status);
					if (type === "idle") {
						// Reconcile a stale local working state without stamping a completion:
						// the work ended while we were not listening, so the timestamp is unknown.
						if (!existing || !wasWorking) continue;
						if (sessions === state.sessions) sessions = { ...sessions };
						sessions[sessionId] = { ...existing, status: "idle", workingSince: undefined };
						continue;
					}
					if (existing && existing.status === type && wasWorking) continue;
					const base = existing ?? createEmptySessionActivity();
					if (sessions === state.sessions) sessions = { ...sessions };
					// Sessions already busy at hydration count from app load — the true
					// start time is only observable via the event stream.
					sessions[sessionId] = {
						...base,
						status: type,
						workingSince: wasWorking ? base.workingSince : timestamp,
					};
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

		setOpenSession: (sessionId) => {
			set((state) =>
				state.openSessionId === sessionId ? state : { ...state, openSessionId: sessionId },
			);
		},
	}));
}
