import type { SessionActivityStore } from "./session-activity-store.js";

type ListResponse<T> = { data?: T | undefined };

/** Structural subset of the Kilo global client used for activity hydration. */
export type SessionActivityHydrationClient = {
	permission: {
		list(): Promise<ListResponse<{ id: string; sessionID: string }[]>>;
	};
	question: {
		list(): Promise<ListResponse<{ id: string; sessionID: string }[]>>;
	};
	session: {
		status(): Promise<ListResponse<Record<string, { type: string }>>>;
	};
};

/**
 * Seeds the store from the server: pending permission/question requests and
 * current session statuses. Event streaming only reports changes, so this runs
 * at startup and after every stream reconnect. Individual endpoint failures are
 * tolerated — the stream keeps delivering fresh signals either way.
 */
export async function hydrateSessionActivity(
	client: SessionActivityHydrationClient,
	store: SessionActivityStore,
): Promise<void> {
	const [permissions, questions, statuses] = await Promise.all([
		client.permission.list().catch(() => undefined),
		client.question.list().catch(() => undefined),
		client.session.status().catch(() => undefined),
	]);
	store.getState().hydratePendingRequests({
		...(permissions ? { permissions: permissions.data ?? [] } : {}),
		...(questions ? { questions: questions.data ?? [] } : {}),
	});
	if (statuses?.data) {
		store.getState().hydrateStatuses(statuses.data);
	}
}
