import type {
	FormInfo,
	KiloClient,
	OpenCodeEventSourceLike,
	OpenCodeServerEvent,
} from "@kilo-desktop/react-opencode-v2";

/** Events that settle a pending prompt, and where they name it. */
const SETTLING_EVENTS: Readonly<Record<string, string>> = {
	"permission.replied": "requestID",
	"form.replied": "id",
	"form.cancelled": "id",
};

/** A chat a thread may show, and the client that reaches it. */
export type PendingPromptChat = readonly [chatId: string, client: KiloClient];

/**
 * The window's event stream, plus the prompts a thread is already waiting on.
 *
 * react-opencode learns of a permission or question (a Kilo v2 form) only
 * from a live `permission.asked` / `form.created` event; it reads the pending
 * lists back only after the stream reconnects. A pane drops its thread's
 * subscription when it unmounts (the person switched to another chat), so a
 * prompt raised meanwhile was never shown: the chat waited on a card that
 * didn't render while the sidebar said "Requires approval". So every
 * subscriber is first sent the pending permissions and forms of the chats
 * `chats` lists, as the events it missed.
 *
 * - Each thread keeps only its own session's requests, as it does live.
 * - A request answered on the stream while the read was in flight is not
 *   replayed, so a stale list can't bring a settled prompt back.
 * - A failed read replays nothing; live events still arrive.
 * - A thread subscribes to the stream once while it has listeners, so the
 *   replay runs per attach, not per render. Re-sending a request a thread
 *   already holds only refreshes its `askedAt`.
 */
export function withPendingPrompts(
	source: OpenCodeEventSourceLike,
	chats: () => readonly PendingPromptChat[],
): OpenCodeEventSourceLike {
	return {
		subscribe(listener) {
			let subscribed = true;
			const settled = new Set<string>();
			const unsubscribe = source.subscribe((event) => {
				const key = SETTLING_EVENTS[event.type];
				const requestId = key ? event.properties[key] : undefined;
				if (typeof requestId === "string") settled.add(requestId);
				listener(event);
			});
			const replay = (
				events: readonly OpenCodeServerEvent[],
				id: (event: OpenCodeServerEvent) => unknown,
			) => {
				for (const event of events) {
					const requestId = id(event);
					if (!subscribed || (typeof requestId === "string" && settled.has(requestId))) continue;
					listener(event);
				}
			};
			for (const [chatId, client] of chats()) {
				void readPending(() => client.permission.list({ sessionID: chatId })).then((requests) =>
					replay(
						requests.map((request) => event("permission.asked", request.sessionID, request)),
						(asked) => asked.properties["id"],
					),
				);
				void readPending(() => client.session.form.list({ sessionID: chatId })).then((forms) =>
					replay(
						forms.map((form: FormInfo) => event("form.created", form.sessionID, { form })),
						(created) => (created.properties["form"] as FormInfo).id,
					),
				);
			}
			return () => {
				subscribed = false;
				unsubscribe();
			};
		},
		dispose: () => source.dispose(),
	};
}

async function readPending<T>(list: () => Promise<readonly T[]>): Promise<readonly T[]> {
	try {
		return await list();
	} catch {
		return [];
	}
}

/** A Kilo v2 event as the window's stream delivers it. */
function event(type: string, sessionId: string, properties: object): OpenCodeServerEvent {
	return {
		type,
		sessionId,
		properties: properties as Record<string, unknown>,
		raw: undefined,
	};
}
