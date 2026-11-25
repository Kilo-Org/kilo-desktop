import type { OpenCodeEvent } from "@kilocode/client";

import type { KiloClient } from "./kilo";
import type { OpenCodeServerEvent } from "./types";

type Listener = (event: OpenCodeServerEvent) => void;

export type OpenCodeEventSubscriber = (options: {
	signal: AbortSignal;
	sseMaxRetryAttempts: number;
}) => Promise<{ stream: AsyncIterable<unknown> }>;

/** The session a Kilo v2 event is about: its `sessionID`, or its form's. */
const sessionIdOf = (event: OpenCodeEvent): string | undefined => {
	if (event.type === "form.created") return event.data.form.sessionID;
	const data: object = event.data;
	return "sessionID" in data && typeof data.sessionID === "string" ? data.sessionID : undefined;
};

const isKiloEvent = (value: unknown): value is OpenCodeEvent => {
	const candidate = value as { type?: unknown; data?: unknown } | null;
	return (
		typeof candidate?.type === "string" &&
		typeof candidate.data === "object" &&
		candidate.data !== null
	);
};

/**
 * The stream reconnected. A subscriber's stream may also yield
 * `{ type: STREAM_RECONNECTED_EVENT_TYPE }` itself to have every thread resync.
 */
export const STREAM_RECONNECTED_EVENT_TYPE = "stream.reconnected";

const toServerEvent = (value: unknown): OpenCodeServerEvent | null => {
	if ((value as { type?: unknown } | null)?.type === STREAM_RECONNECTED_EVENT_TYPE) {
		return { type: STREAM_RECONNECTED_EVENT_TYPE };
	}
	if (!isKiloEvent(value)) return null;
	return {
		type: "kilo.event",
		event: value,
		sessionId: sessionIdOf(value),
		directory: value.location?.directory,
	};
};

export class OpenCodeEventSource {
	private readonly listeners = new Set<Listener>();
	private readonly reconnectDelayMs = 1_000;
	private readonly maxReconnectDelayMs = 30_000;
	private abortController: AbortController | null = null;
	private connectionPromise: Promise<void> | null = null;
	private stopped = false;
	private nextReconnectDelayMs = this.reconnectDelayMs;
	private hadConnection = false;

	private readonly subscribeToEvents: OpenCodeEventSubscriber;
	private readonly onEvent: ((event: OpenCodeServerEvent) => void) | undefined;

	/** `subscribeToEvents` opens Kilo v2's event stream (`kiloEventSubscriber`). */
	constructor(
		subscribeToEvents: OpenCodeEventSubscriber,
		onEvent?: (event: OpenCodeServerEvent) => void,
	) {
		this.subscribeToEvents = subscribeToEvents;
		this.onEvent = onEvent;
	}

	public subscribe(listener: Listener) {
		this.listeners.add(listener);
		this.connect();

		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				this.disconnect();
			}
		};
	}

	public dispose() {
		this.stopped = true;
		this.disconnect();
	}

	private emit(event: OpenCodeServerEvent) {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error) {
				console.error("[react-opencode] Listener threw an error", error);
			}
		}
	}

	private connect() {
		if (this.connectionPromise || this.stopped) return;
		const connection = this.run().finally(() => {
			if (this.connectionPromise === connection) {
				this.connectionPromise = null;
				if (!this.stopped && this.listeners.size > 0) {
					this.connect();
				}
			}
		});
		this.connectionPromise = connection;
	}

	private disconnect() {
		this.abortController?.abort();
		this.abortController = null;
	}

	private async run() {
		while (!this.stopped) {
			if (this.listeners.size === 0) return;

			const abortController = new AbortController();
			this.abortController = abortController;
			let failedToConnect = true;
			let reconnectDelayMs = this.reconnectDelayMs;

			try {
				const subscription = await this.subscribeToEvents({
					signal: abortController.signal,
					sseMaxRetryAttempts: 1,
				});
				failedToConnect = false;
				this.nextReconnectDelayMs = this.reconnectDelayMs;

				if (this.hadConnection) {
					this.emit({ type: STREAM_RECONNECTED_EVENT_TYPE });
				}
				this.hadConnection = true;

				for await (const event of subscription.stream) {
					if (abortController.signal.aborted || this.stopped) {
						return;
					}

					const normalized = toServerEvent(event);
					if (!normalized) continue;
					this.onEvent?.(normalized);
					this.emit(normalized);
				}
				if (abortController.signal.aborted || this.stopped) {
					return;
				}
			} catch (error) {
				if (abortController.signal.aborted || this.stopped) return;
				console.warn("[react-opencode] OpenCode event stream disconnected", error);
				if (failedToConnect) {
					reconnectDelayMs = this.nextReconnectDelayMs;
					this.nextReconnectDelayMs = Math.min(
						this.nextReconnectDelayMs * 2,
						this.maxReconnectDelayMs,
					);
				}
			} finally {
				if (this.abortController === abortController) {
					this.abortController = null;
				}
			}

			if (this.listeners.size === 0) return;

			await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));
		}
	}
}

/** An `OpenCodeEventSubscriber` over a `@kilocode/client`'s event stream. */
export function kiloEventSubscriber(client: KiloClient): OpenCodeEventSubscriber {
	return async ({ signal }) => ({ stream: client.event.subscribe({ signal }) });
}
