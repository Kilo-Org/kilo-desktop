import { sessionsAwaitingParentLookup } from "./session-activity-logic.js";
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
		get?(parameters: {
			sessionID: string;
		}): Promise<ListResponse<{ id: string; parentID?: string | undefined }>>;
	};
};

/** Bounds the ancestor walk for nested subagents (and any malformed parent cycle). */
const MAX_PARENT_LOOKUP_DEPTH = 8;

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
	// Capture before the network round-trip so a live ask/reply during the fetch
	// can force a union merge instead of a stale snapshot replace.
	const sinceEpoch = store.getState().activityEpoch;
	const [permissions, questions, statuses] = await Promise.all([
		client.permission.list().catch(() => undefined),
		client.question.list().catch(() => undefined),
		client.session.status().catch(() => undefined),
	]);
	store.getState().hydratePendingRequests({
		...(permissions ? { permissions: permissions.data ?? [] } : {}),
		...(questions ? { questions: questions.data ?? [] } : {}),
		sinceEpoch,
	});
	if (statuses?.data) {
		store.getState().hydrateStatuses(statuses.data, sinceEpoch);
	}
	await hydratePromptAncestry(client, store);
}

/**
 * A prompt raised by a subagent is keyed by the child session, and the
 * session list only knows root chats. Live `session.created` events carry the
 * parent link, but prompts recovered at startup/reconnect (or ancestors of a
 * live-linked nested subagent) may predate them, so resolve each prompting
 * session's chain up from its topmost unlinked ancestor here.
 */
export async function hydratePromptAncestry(
	client: SessionActivityHydrationClient,
	store: SessionActivityStore,
): Promise<void> {
	// Call `get` as a method: on the deferred runtime client every property,
	// including `bind`, is a lazy network proxy, so `get.bind(...)` would start
	// a request whose rejection nobody observes.
	const sessionApi = client.session;
	if (!sessionApi.get) return;
	const checked = new Set<string>();
	let frontier = sessionsAwaitingParentLookup(store.getState().sessions);
	for (let depth = 0; depth < MAX_PARENT_LOOKUP_DEPTH && frontier.length > 0; depth++) {
		for (const sessionId of frontier) checked.add(sessionId);
		const sessions = await Promise.all(
			frontier.map(async (sessionID) => {
				try {
					return (await sessionApi.get?.({ sessionID }))?.data;
				} catch {
					return undefined;
				}
			}),
		);
		const links = sessions.flatMap((session) =>
			session?.id && session.parentID ? [{ id: session.id, parentId: session.parentID }] : [],
		);
		if (links.length === 0) return;
		store.getState().hydrateSessions(links);
		frontier = sessionsAwaitingParentLookup(store.getState().sessions).filter(
			(sessionId) => !checked.has(sessionId),
		);
	}
}
