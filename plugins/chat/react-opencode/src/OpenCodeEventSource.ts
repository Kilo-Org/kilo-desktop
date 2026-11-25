import type { OpenCodeClient } from "@kilocode/client";
import type { OpenCodeServerEvent } from "./types";

type Listener = (event: OpenCodeServerEvent) => void;

/** Opens the server's v2 event stream (`/api/event`) until `signal` aborts. */
export type OpenCodeEventSubscriber = (options: {
	signal: AbortSignal;
}) => Promise<{ stream: AsyncIterable<unknown> }> | { stream: AsyncIterable<unknown> };

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

/** The session a v2 frame is about: `data.sessionID`, or a form's. */
export const sessionIdOfEvent = (data: Record<string, unknown>): string | undefined => {
	if (typeof data.sessionID === "string") return data.sessionID;
	const form = asRecord(data.form);
	return typeof form?.sessionID === "string" ? form.sessionID : undefined;
};

/** A v2 frame (`{ id, created, type, location, data, metadata }`) for the thread layer. */
export const normalizeEventPayload = (event: unknown): OpenCodeServerEvent | null => {
	const frame = asRecord(event);
	if (!frame || typeof frame.type !== "string") return null;
	const data = asRecord(frame.data) ?? {};
	const location = asRecord(frame.location);
	return {
		type: frame.type,
		data,
		...(typeof frame.id === "string" ? { id: frame.id } : {}),
		...(typeof frame.created === "number" ? { created: frame.created } : {}),
		...(asRecord(frame.metadata) ? { metadata: frame.metadata as Record<string, unknown> } : {}),
		...(typeof location?.directory === "string"
			? { location: { directory: location.directory } }
			: {}),
		sessionId: sessionIdOfEvent(data),
	};
};

/** What the server sends first on every (re)connect. */
const SERVER_CONNECTED = "server.connected";

export const STREAM_RECONNECTED_EVENT_TYPE = "stream.reconnected";

export class OpenCodeEventSource {
	private readonly listeners = new Set<Listener>();
	private readonly reconnectDelayMs = 1_000;
	private readonly maxReconnectDelayMs = 30_000;
	private abortController: AbortController | null = null;
	private connectionPromise: Promise<void> | null = null;
	private stopped = false;
	private nextReconnectDelayMs = this.reconnectDelayMs;

	private readonly subscribeToEvents: OpenCodeEventSubscriber;
	private readonly onEvent: ((event: OpenCodeServerEvent) => void) | undefined;

	constructor(
		client: OpenCodeClient,
		subscribeToEvents?: OpenCodeEventSubscriber,
		onEvent?: (event: OpenCodeServerEvent) => void,
	) {
		this.subscribeToEvents =
			subscribeToEvents ?? (({ signal }) => ({ stream: client.event.subscribe({ signal }) }));
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
				const subscription = await this.subscribeToEvents({ signal: abortController.signal });
				failedToConnect = false;
				this.nextReconnectDelayMs = this.reconnectDelayMs;

				for await (const event of subscription.stream) {
					if (abortController.signal.aborted || this.stopped) {
						return;
					}

					const normalized = normalizeEventPayload(event);
					if (!normalized) continue;
					this.onEvent?.(normalized);
					this.emit(normalized);
					// The stream replays nothing: once the server publishes to this
					// subscription, threads read again what they may have missed.
					if (normalized.type === SERVER_CONNECTED) {
						this.emit({ type: STREAM_RECONNECTED_EVENT_TYPE, data: {}, sessionId: undefined });
					}
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
