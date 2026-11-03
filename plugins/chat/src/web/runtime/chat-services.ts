import {
	OpenCodeEventSource,
	type OpenCodeEventSourceLike,
	type OpenCodeEventSubscriber,
} from "@assistant-ui/react-opencode";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { DomainHandle } from "@kilo-desktop/kernel";
import type { AgentServer, ServerConnection } from "@kilo-desktop/plugin-agent/contracts";

import { createDeferredKiloClient } from "./deferred-client";
import { KiloClients } from "./kilo-client";

type ServerHandle = DomainHandle<typeof AgentServer>;

/**
 * What every agent pane in a window shares: how to reach the Kilo server, its
 * clients, and one event stream.
 *
 * - The connection comes from `kilo.agent/server.connect()`, which waits for
 *   the server. It is read once per server start (a restart may change the
 *   address or password) and re-read after the server leaves `ready`.
 * - The transcript runtime (react-opencode) needs live message parts, which
 *   kilo.agent's main-process stream doesn't carry, so the window keeps its
 *   own subscription to the server's global stream (decision 51). It is one
 *   per window however many panes are open, opened by the first pane that
 *   needs it and closed when the last lets go; on a reconnect it resolves the
 *   connection again. kilo.agent's stream stays the source of truth for chat
 *   status and activity.
 */
export class ChatServices {
	readonly clients = new KiloClients();
	readonly #server: () => ServerHandle | null;
	#watched: ServerHandle | null = null;
	#stopWatching: (() => void) | undefined;
	#connection: Promise<ServerConnection> | undefined;
	#events: { source: OpenCodeEventSource; holders: number } | undefined;

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

	/** A share of the window's event stream; dispose it to let go. */
	retainEvents(): OpenCodeEventSourceLike {
		this.#events ??= { source: this.#openEvents(), holders: 0 };
		const shared = this.#events;
		shared.holders += 1;
		let released = false;
		return {
			subscribe: (listener) => shared.source.subscribe(listener),
			dispose: () => {
				if (released) return;
				released = true;
				shared.holders -= 1;
				if (shared.holders > 0) return;
				shared.source.dispose();
				if (this.#events === shared) this.#events = undefined;
			},
		};
	}

	dispose(): void {
		this.#stopWatching?.();
		this.#events?.source.dispose();
		this.#events = undefined;
		this.#connection = undefined;
	}

	#openEvents(): OpenCodeEventSource {
		const subscribe: OpenCodeEventSubscriber = async (options) => {
			const client = this.clients.global(await this.connection());
			const subscription = await client.global.event(options as never);
			return { stream: subscription.stream as AsyncIterable<unknown> };
		};
		return new OpenCodeEventSource(this.globalClient as never, subscribe);
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
