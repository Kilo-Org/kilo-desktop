import {
	OpenCodeEventSource,
	STREAM_RECONNECTED_EVENT_TYPE,
	type OpenCodeEventSourceLike,
	type OpenCodeEventSubscriber,
} from "@kilo-desktop/react-opencode";
import type { OpenCodeClient } from "@kilocode/client";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { KiloServer, ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { ChatSelections } from "../selection/chat-selections";
import { createDeferredKiloClient } from "./deferred-client";
import { createEventBatcher } from "./event-batcher";
import { HistoryPrefetch, withPrefetchedHistory } from "./history-prefetch";
import { kiloClient } from "./kilo-client";
import { LiveParts, withLiveParts } from "./live-parts";

type ServerHandle = DomainObjectHandle<typeof KiloServer>;

/**
 * What every agent pane in a window shares: how to reach the Kilo server, its
 * client, and one event stream.
 *
 * - The connection comes from `kilo.core/server.connect()`, which waits for
 *   the server. It is read once per server start (a restart may change the
 *   address or password) and re-read after the server leaves `ready`.
 * - The transcript runtime (react-opencode) needs live message parts, which
 *   kilo.core's main-process stream doesn't carry, so the window keeps its
 *   own subscription to the server's global stream (decision 51). It is one
 *   per window however many panes are open, opened by the first pane that
 *   needs it and kept until the window goes; on a reconnect it resolves the
 *   connection again, and react-opencode's event source has every thread
 *   read its state again after each `server.connected`. kilo.core's stream
 *   stays the source of truth for chat status and activity.
 * - The stream outlives the panes because a pane is unmounted whenever the
 *   person switches session. A stream reopened per switch misses whatever the
 *   server publishes while it connects, and a thread that misses its turn's
 *   end shows it running until it is opened again.
 * - Each chat's agent and model selection outlives its pane for the same
 *   reason (see `ChatSelections`).
 */
export class ChatServices {
	readonly selections = new ChatSelections();
	readonly #server: () => ServerHandle | null;
	#watched: ServerHandle | null = null;
	#stopWatching: (() => void) | undefined;
	#connection: Promise<ServerConnection> | undefined;
	#events: OpenCodeEventSource | undefined;
	#batcher = createEventBatcher();

	constructor(server: () => ServerHandle | null) {
		this.#server = server;
	}

	/** The running server's connection, waiting for it to be ready. */
	connection(): Promise<ServerConnection> {
		const server = this.#server();
		if (!server) return Promise.reject(new Error("The Kilo server isn't available."));
		this.#watch(server);
		if (!this.#connection) {
			const pending = server.methods.connect(undefined);
			this.#connection = pending;
			pending.catch(() => {
				if (this.#connection === pending) this.#connection = undefined;
			});
		}
		return this.#connection;
	}

	/** The window's client for the running server, waiting for it to be ready. */
	async kiloClient(): Promise<OpenCodeClient> {
		return kiloClient(await this.connection());
	}

	/** A client usable at once that follows the current connection. */
	readonly client: OpenCodeClient = createDeferredKiloClient(() => this.kiloClient());

	/** Chat histories loaded ahead of opening (see history-prefetch.ts). */
	readonly history = new HistoryPrefetch();

	/** The text of parts streaming now, for history read mid-stream (see live-parts.ts). */
	readonly liveParts = new LiveParts();

	/** `client` for transcripts: history reads served from prefetches and filled with live text. */
	readonly transcriptClient: OpenCodeClient = withLiveParts(
		withPrefetchedHistory(this.client, this.history),
		this.liveParts,
	);

	/**
	 * The window's event stream, opened on first use and delivered in
	 * batches (see event-batcher.ts). A runtime's `dispose` only lets go of
	 * its view of it; the stream stays open until the window's services are
	 * disposed.
	 */
	events(): OpenCodeEventSourceLike {
		this.#events ??= this.#openEvents();
		const batcher = this.#batcher;
		return {
			subscribe: (listener) => batcher.subscribe(listener),
			dispose: () => undefined,
		};
	}

	/**
	 * Drops a permission request the server no longer waits on from every
	 * thread in the window, as if its reply had arrived on the stream (one
	 * answered while no thread was listening would otherwise keep its card).
	 */
	settlePermission(permissionId: string, chatId: string): void {
		this.#batcher.push({
			type: "permission.replied",
			data: { sessionID: chatId, requestID: permissionId, reply: "once" },
			sessionId: chatId,
		});
	}

	/**
	 * Loads `chatId`'s history ahead, so opening it shows the transcript
	 * without a round trip. Best effort: a failure is the opening thread's to
	 * report when it loads.
	 */
	prefetchHistory(chatId: string): void {
		// The stream must be open for an event about the chat to drop a stale prefetch.
		this.events();
		void this.kiloClient()
			.then((client) => this.history.prefetch(chatId, client))
			.catch(() => undefined);
	}

	dispose(): void {
		this.history.clear();
		this.liveParts.clear();
		this.#stopWatching?.();
		this.#events?.dispose();
		this.#events = undefined;
		this.#batcher.dispose();
		this.#batcher = createEventBatcher();
		this.#connection = undefined;
	}

	#openEvents(): OpenCodeEventSource {
		const subscribe: OpenCodeEventSubscriber = async ({ signal }) => {
			const client = await this.kiloClient();
			return { stream: client.event.subscribe({ signal }) };
		};
		const source = new OpenCodeEventSource(this.client, subscribe);
		// The batcher is the source's one listener, which also keeps it connected.
		// Anything about a chat (or a reconnect) makes its prefetched history stale.
		const batcher = this.#batcher;
		source.subscribe((event) => {
			if (event.type === STREAM_RECONNECTED_EVENT_TYPE) this.history.clear();
			else this.history.invalidate(event.sessionId);
			batcher.push(event);
		});
		// Batched like the threads' events, so it never runs ahead of them.
		const liveParts = this.liveParts;
		batcher.subscribe((event) => liveParts.apply(event));
		return source;
	}

	#watch(server: ServerHandle): void {
		if (this.#watched === server) return;
		this.#stopWatching?.();
		this.#watched = server;
		this.#connection = undefined;
		this.#stopWatching = server.subscribe((state) => {
			if (state.status !== "ready") this.#connection = undefined;
		});
	}
}
