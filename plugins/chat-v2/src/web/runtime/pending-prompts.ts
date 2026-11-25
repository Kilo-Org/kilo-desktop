import type {
	KiloClient,
	OpenCodeEvent,
	OpenCodeEventSourceLike,
	OpenCodeServerEvent,
} from "@kilo-desktop/react-opencode-v2";

/** The prompt an event settles: a replied permission, or a replied or cancelled form. */
const settledPromptId = (item: OpenCodeServerEvent): string | undefined => {
	if (item.type !== "kilo.event") return undefined;
	const { event } = item;
	if (event.type === "permission.replied") return event.data.requestID;
	if (event.type === "form.replied" || event.type === "form.cancelled") return event.data.id;
	return undefined;
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
				const settledId = settledPromptId(event);
				if (settledId) settled.add(settledId);
				listener(event);
			});
			const replay = (promptId: string, sessionId: string, event: OpenCodeEvent) => {
				if (!subscribed || settled.has(promptId)) return;
				listener({ type: "kilo.event", event, sessionId, directory: undefined });
			};
			for (const [chatId, client] of chats()) {
				void readPending(() => client.permission.list({ sessionID: chatId })).then((requests) => {
					for (const request of requests) {
						replay(request.id, request.sessionID, {
							...replayed(),
							type: "permission.asked",
							data: request,
						});
					}
				});
				void readPending(() => client.session.form.list({ sessionID: chatId })).then((forms) => {
					for (const form of forms) {
						// The list's form and the event's are generated apart (the list's
						// integer bounds may read "Infinity"); they are the same form.
						const data = { form } as Extract<OpenCodeEvent, { type: "form.created" }>["data"];
						replay(form.id, form.sessionID, { ...replayed(), type: "form.created", data });
					}
				});
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

/** The envelope of an event replayed from a pending list rather than the stream. */
function replayed(): { id: string; created: number } {
	return { id: `evt_replayed_${crypto.randomUUID()}`, created: Date.now() };
}
