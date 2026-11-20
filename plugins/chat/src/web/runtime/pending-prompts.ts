import type { OpenCodeEventSourceLike, OpenCodeServerEvent } from "@kilo-desktop/react-opencode";
import type { KiloClient } from "@kilocode/sdk/v2/client";

const REQUEST_OPTIONS = { throwOnError: true } as const;

type PendingRequest = { readonly id: string; readonly sessionID: string };

const SETTLING_EVENTS = new Set(["permission.replied", "question.replied", "question.rejected"]);

/**
 * The window's event stream, plus the prompts a thread is already waiting on.
 *
 * react-opencode learns of a permission or question only from a live
 * `*.asked` event; it reads the pending lists back only after the stream
 * reconnects. A pane drops its thread's subscription when it unmounts (the
 * person switched to another chat), so a prompt raised meanwhile was never
 * shown: the chat waited on a card that didn't render while the sidebar said
 * "Requires approval". So every subscriber is first sent the pending requests
 * of the chat directories `clients` reach, as the `*.asked` events it missed.
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
	clients: () => readonly KiloClient[],
): OpenCodeEventSourceLike {
	return {
		subscribe(listener) {
			let subscribed = true;
			const settled = new Set<string>();
			const unsubscribe = source.subscribe((event) => {
				const requestId = event.properties["requestID"];
				if (SETTLING_EVENTS.has(event.type) && typeof requestId === "string") {
					settled.add(requestId);
				}
				listener(event);
			});
			const replay = (type: string, requests: readonly PendingRequest[]) => {
				for (const request of requests) {
					if (!subscribed || settled.has(request.id)) continue;
					listener(askedEvent(type, request));
				}
			};
			for (const client of clients()) {
				void readPending(() => client.permission.list(undefined, REQUEST_OPTIONS)).then(
					(requests) => replay("permission.asked", requests),
				);
				void readPending(() => client.question.list(undefined, REQUEST_OPTIONS)).then((requests) =>
					replay("question.asked", requests),
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

async function readPending(
	list: () => Promise<{ data?: readonly PendingRequest[] | undefined }>,
): Promise<readonly PendingRequest[]> {
	try {
		return (await list()).data ?? [];
	} catch {
		return [];
	}
}

function askedEvent(type: string, request: PendingRequest): OpenCodeServerEvent {
	return {
		type,
		sessionId: request.sessionID,
		properties: request as unknown as Record<string, unknown>,
		raw: undefined,
	};
}
