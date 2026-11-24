import {
	OpenCodeEventSource,
	STREAM_RECONNECTED_EVENT_TYPE,
	type OpenCodeEventSourceLike,
	type OpenCodeEventSubscriber,
} from "@kilo-desktop/react-opencode-v2";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { KiloServer, ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { ChatSelections } from "../selection/chat-selections";
import { createDeferredKiloClient } from "./deferred-client";
import { createEventBatcher } from "./event-batcher";
import { HistoryPrefetch } from "./history-prefetch";
import { KiloClients } from "./kilo-client";
import { LiveParts } from "./live-parts";

type ServerHandle = DomainObjectHandle<typeof KiloServer>;

/** What the server sends first on every (re)connect, once it publishes to that subscription. */
const SERVER_CONNECTED = "server.connected";
const RESYNC_EVENT = { payload: { type: STREAM_RECONNECTED_EVENT_TYPE, properties: {} } };

const eventType = (event: unknown): unknown => {
	const outer = event as { type?: unknown; payload?: { type?: unknown } } | null;
	return outer?.payload?.type ?? outer?.type;
};

/**
 * `stream` with a resync for every thread after each `server.connected`.
 * react-opencode resyncs threads (history, status, pending prompts) only on a
 * reconnect, and as soon as it asks for the stream rather than once the server
 * is publishing to it, so a thread that read its state while the stream was
 * connecting would keep anything it missed meanwhile, such as its turn ending.
 */
export async function* resyncOnceConnected(
	stream: AsyncIterable<unknown>,
): AsyncGenerator<unknown> {
	for await (const event of stream) {
		yield event;
		if (eventType(event) === SERVER_CONNECTED) yield RESYNC_EVENT;
	}
}

/**
 * What every agent pane in a window shares: how to reach the Kilo server, its
 * clients, and one event stream.
 *
 * - The connection comes from `kilo.core/server.connect()`, which waits for
 *   the server. It is read once per server start (a restart may change the
 *   address or password) and re-read after the server leaves `ready`.
 * - The transcript runtime (react-opencode) needs live message parts, which
 *   kilo.core's main-process stream doesn't carry, so the window keeps its
 *   own subscription to the server's global stream (decision 51). It is one
 *   per window however many panes are open, opened by the first pane that
 *   needs it and kept until the window goes; on a reconnect it resolves the
 *   connection again. kilo.core's stream stays the source of truth for chat
 *   status and activity.
 * - The stream outlives the panes because a pane is unmounted whenever the
 *   person switches session. A stream reopened per switch misses whatever the
 *   server publishes while it connects, and a thread that misses its turn's
 *   end shows it running until it is opened again.
 * - Each chat's agent and model selection outlives its pane for the same
 *   reason (see `ChatSelections`).
 */
export class ChatServices {
	readonly clients = new KiloClients();
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

	/** A global client (no directory) that follows the current connection. */
	readonly globalClient: KiloClient = createDeferredKiloClient(async () =>
		this.clients.global(await this.connection()),
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

	/** Chat histories loaded ahead of opening (see history-prefetch.ts). */
	readonly history = new HistoryPrefetch();

	/** The text of parts streaming now, for history read mid-stream (see live-parts.ts). */
	readonly liveParts = new LiveParts();

	/**
	 * Loads `chatId`'s history ahead, so opening it shows the transcript
	 * without a round trip. Best effort: a failure is the opening thread's to
	 * report when it loads.
	 */
	prefetchHistory(chatId: string, directory: string | null): void {
		// The stream must be open for an event about the chat to drop a stale prefetch.
		this.events();
		void (async () => {
			const connection = await this.connection();
			const where = directory ?? (await this.#directoryOf(chatId));
			if (where) this.history.prefetch(chatId, this.clients.directory(connection, where));
		})().catch(() => undefined);
	}

	async #directoryOf(chatId: string): Promise<string | null> {
		const { data } = await this.globalClient.session.get({ sessionID: chatId });
		return data?.directory ?? null;
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
		const subscribe: OpenCodeEventSubscriber = async (options) => {
			const client = this.clients.global(await this.connection());
			const subscription = await client.global.event(withSkipForkSync(options) as never);
			return { stream: resyncOnceConnected(subscription.stream as AsyncIterable<unknown>) };
		};
		const source = new OpenCodeEventSource(this.globalClient as never, subscribe);
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

/**
 * A fork replays its whole copied transcript twice on `/global/event`: as the
 * usual events and as durable `sync` copies, which no thread reads. VS Code
 * and JetBrains send the same header.
 */
function withSkipForkSync(options: unknown): Record<string, unknown> {
	const given = (options ?? {}) as { headers?: Record<string, string> };
	return { ...given, headers: { ...given.headers, "x-kilo-sse-skip-fork-sync": "1" } };
}
