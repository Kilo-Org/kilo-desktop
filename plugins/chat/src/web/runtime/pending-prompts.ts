import {
	STREAM_RECONNECTED_EVENT_TYPE,
	type OpenCodeEventSourceLike,
	type OpenCodeServerEvent,
} from "@kilo-desktop/react-opencode";
import type { KiloClient } from "@kilocode/sdk/v2/client";

const REQUEST_OPTIONS = { throwOnError: true } as const;

type PromptKind = "permission" | "question";
type Listener = (event: OpenCodeServerEvent) => void;
type PendingRequest = { readonly id: string; readonly sessionID: string };

interface PendingList {
	readonly requests: readonly PendingRequest[];
	/** Every client's list was read: a request missing from it is no longer pending. */
	readonly complete: boolean;
}

interface KnownPrompt {
	readonly kind: PromptKind;
	readonly sessionId: string;
	/** The clock when it was first announced to this source's subscribers. */
	readonly since: number;
}

const ASKED_EVENTS: ReadonlyMap<string, PromptKind> = new Map([
	["permission.asked", "permission"],
	["question.asked", "question"],
]);

const SETTLING_EVENTS = new Set(["permission.replied", "question.replied", "question.rejected"]);

/**
 * The most prompts remembered for settling. Only a complete read forgets
 * them, so a list that never reads would otherwise grow for the window's
 * life; the oldest go first, and a forgotten one still clears from its card.
 */
const MAX_KNOWN_PROMPTS = 500;

/**
 * The window's event stream, kept in step with the prompts the server is
 * actually waiting on.
 *
 * react-opencode learns of a permission or question only from a live
 * `*.asked` event and forgets it only on a live `*.replied`; it reads the
 * pending lists back only after the stream reconnects, and then only adds.
 * Its threads outlive their panes and stop listening while hidden and idle,
 * so a prompt can be missed either way:
 *
 * - raised while the thread wasn't listening: the chat waited on a card that
 *   didn't render while the sidebar said "Requires approval";
 * - answered while it wasn't listening (by Auto approve in main, another
 *   window, an abort), or across a dropped stream: the card stayed, and every
 *   answer failed with "not found".
 *
 * So whenever a thread subscribes, and after every reconnect, the pending
 * lists of the chat directories `clients` reach are read, and:
 *
 * - each request is replayed to the new subscriber as the `*.asked` event it
 *   may have missed (a thread keeps only its own session's; re-sending one it
 *   holds only refreshes its `askedAt`);
 * - each prompt announced before the read that the server no longer lists is
 *   settled for every subscriber with a synthetic `permission.replied`
 *   ("once": Auto approve is what answers prompts nobody saw) or
 *   `question.rejected`. Only when every list was read, and only to this
 *   source's own subscribers, whose sessions those clients cover.
 *
 * A prompt answered on the stream while a read was in flight is not
 * replayed, so a stale list can't bring a settled prompt back; one asked
 * during the read is not settled for missing from it. A failed read replays
 * what the other lists hold and settles nothing; live events still arrive.
 */
export function withPendingPrompts(
	source: OpenCodeEventSourceLike,
	clients: () => readonly KiloClient[],
): OpenCodeEventSourceLike {
	const listeners = new Set<Listener>();
	const known = new Map<string, KnownPrompt>();
	const settledAt = new Map<string, number>();
	let clock = 0;
	let readsInFlight = 0;
	let lastReconnect: OpenCodeServerEvent | undefined;

	const remember = (kind: PromptKind, id: string, sessionId: string) => {
		if (known.has(id)) return;
		known.set(id, { kind, sessionId, since: ++clock });
		if (known.size > MAX_KNOWN_PROMPTS) {
			const oldest = known.keys().next().value;
			if (oldest !== undefined) known.delete(oldest);
		}
	};

	const deliver = (listener: Listener, event: OpenCodeServerEvent) => {
		try {
			listener(event);
		} catch (error) {
			console.error("[kilo.chat] A pending-prompt listener threw", error);
		}
	};

	const settle = (id: string) => {
		known.delete(id);
		// A read still in flight may list it from before; it must not bring it back.
		if (readsInFlight > 0) settledAt.set(id, ++clock);
	};

	const track = (event: OpenCodeServerEvent) => {
		const askedKind = ASKED_EVENTS.get(event.type);
		if (askedKind) {
			const { id, sessionID } = event.properties;
			const sessionId = event.sessionId ?? sessionID;
			if (typeof id === "string" && typeof sessionId === "string") {
				remember(askedKind, id, sessionId);
			}
			return;
		}
		const requestId = event.properties["requestID"];
		if (SETTLING_EVENTS.has(event.type) && typeof requestId === "string") {
			settle(requestId);
		}
	};

	const settleMissing = (kind: PromptKind, list: PendingList, startedAt: number) => {
		if (!list.complete) return;
		const pending = new Set(list.requests.map((request) => request.id));
		for (const [id, prompt] of known) {
			if (prompt.kind !== kind || prompt.since > startedAt || pending.has(id)) continue;
			settle(id);
			const event = settledPromptEvent(kind, id, prompt.sessionId);
			for (const listener of listeners) deliver(listener, event);
		}
	};

	const replay = (
		kind: PromptKind,
		list: PendingList,
		startedAt: number,
		listener: Listener | undefined,
	) => {
		for (const request of list.requests) {
			if ((settledAt.get(request.id) ?? 0) > startedAt) continue;
			remember(kind, request.id, request.sessionID);
			if (listener && listeners.has(listener)) deliver(listener, askedEvent(kind, request));
		}
	};

	const sync = (replayTo?: Listener) => {
		read(replayTo).catch((error: unknown) => {
			console.error("[kilo.chat] Could not sync the pending prompts", error);
		});
	};

	const read = async (replayTo: Listener | undefined) => {
		const startedAt = ++clock;
		readsInFlight += 1;
		try {
			const targets = clients();
			const [permissions, questions] = await Promise.all([
				readAll(targets, (client) => client.permission.list(undefined, REQUEST_OPTIONS)),
				readAll(targets, (client) => client.question.list(undefined, REQUEST_OPTIONS)),
			]);
			replay("permission", permissions, startedAt, replayTo);
			replay("question", questions, startedAt, replayTo);
			settleMissing("permission", permissions, startedAt);
			settleMissing("question", questions, startedAt);
		} finally {
			readsInFlight -= 1;
			if (readsInFlight === 0) settledAt.clear();
		}
	};

	return {
		subscribe(listener) {
			// Each subscriber gets its own entry, even if it is the same function.
			const own: Listener = (event) => listener(event);
			listeners.add(own);
			const unsubscribe = source.subscribe((event) => {
				track(event);
				own(event);
				// Every subscriber sees the same reconnect; one read serves them all.
				if (event.type === STREAM_RECONNECTED_EVENT_TYPE && event !== lastReconnect) {
					lastReconnect = event;
					sync();
				}
			});
			sync(own);
			return () => {
				listeners.delete(own);
				unsubscribe();
			};
		},
		dispose: () => source.dispose(),
	};
}

/** The event that settles a prompt the server no longer waits on. */
export function settledPromptEvent(
	kind: PromptKind,
	requestId: string,
	sessionId: string,
): OpenCodeServerEvent {
	const properties: Record<string, unknown> =
		kind === "permission"
			? { sessionID: sessionId, requestID: requestId, reply: "once" }
			: { sessionID: sessionId, requestID: requestId };
	return {
		type: kind === "permission" ? "permission.replied" : "question.rejected",
		sessionId,
		properties,
		raw: undefined,
	};
}

async function readAll(
	clients: readonly KiloClient[],
	list: (client: KiloClient) => Promise<{ data?: readonly PendingRequest[] | undefined }>,
): Promise<PendingList> {
	const results = await Promise.allSettled(clients.map(async (client) => list(client)));
	const requests: PendingRequest[] = [];
	let complete = true;
	for (const result of results) {
		if (result.status === "fulfilled") requests.push(...(result.value.data ?? []));
		else complete = false;
	}
	return { requests, complete };
}

function askedEvent(kind: PromptKind, request: PendingRequest): OpenCodeServerEvent {
	return {
		type: `${kind}.asked`,
		sessionId: request.sessionID,
		properties: request as unknown as Record<string, unknown>,
		raw: undefined,
	};
}
