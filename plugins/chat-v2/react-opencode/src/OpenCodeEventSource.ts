import type { OpencodeClient } from "./sdk";
import type { OpenCodeServerEvent } from "./types";

type Listener = (event: OpenCodeServerEvent) => void;

export type OpenCodeEventSubscriber = (options: {
	signal: AbortSignal;
	sseMaxRetryAttempts: number;
}) => Promise<{ stream: AsyncIterable<unknown> }>;

const asRecord = (value: unknown): Record<string, unknown> | null => {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
};

const extractSessionId = (
	type: string,
	properties: Record<string, unknown>,
): string | undefined => {
	if (typeof properties.sessionID === "string") {
		return properties.sessionID;
	}

	const info = asRecord(properties.info);
	if (info) {
		if (typeof info.sessionID === "string") {
			return info.sessionID;
		}

		if (
			(type === "session.created" || type === "session.updated" || type === "session.deleted") &&
			typeof info.id === "string"
		) {
			return info.id;
		}
	}

	const part = asRecord(properties.part);
	if (part && typeof part.sessionID === "string") {
		return part.sessionID;
	}

	return undefined;
};

const normalizeEventPayload = (event: unknown): OpenCodeServerEvent | null => {
	const outer = asRecord(event);
	if (!outer) return null;

	const payload = asRecord(outer.payload);
	const candidate = payload ?? outer;

	if (
		typeof candidate.type !== "string" ||
		!("properties" in candidate) ||
		!asRecord(candidate.properties)
	) {
		return null;
	}

	const normalized = {
		type: candidate.type,
		properties: candidate.properties as Record<string, unknown>,
		directory: typeof outer.directory === "string" ? outer.directory : undefined,
		sessionId: extractSessionId(candidate.type, candidate.properties as Record<string, unknown>),
		raw: event,
	} satisfies OpenCodeServerEvent;

	return normalized;
};

export const STREAM_RECONNECTED_EVENT_TYPE = "stream.reconnected";

export class OpenCodeEventSource {
	private readonly listeners = new Set<Listener>();
	private readonly reconnectDelayMs = 1_000;
	private readonly maxReconnectDelayMs = 30_000;
	private abortController: AbortController | null = null;
	private connectionPromise: Promise<void> | null = null;
	private stopped = false;
	private nextReconnectDelayMs = this.reconnectDelayMs;
	private hadConnection = false;

	private readonly client: OpencodeClient;
	private readonly subscribeToEvents: OpenCodeEventSubscriber;
	private readonly onEvent: ((event: OpenCodeServerEvent) => void) | undefined;

	constructor(
		client: OpencodeClient,
		subscribeToEvents?: OpenCodeEventSubscriber,
		onEvent?: (event: OpenCodeServerEvent) => void,
	) {
		this.client = client;
		this.subscribeToEvents =
			subscribeToEvents ?? ((options) => this.client.event.subscribe(undefined, options));
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
					this.emit({
						type: STREAM_RECONNECTED_EVENT_TYPE,
						sessionId: undefined,
						raw: undefined,
						properties: {},
					});
				}
				this.hadConnection = true;

				for await (const event of subscription.stream) {
					if (abortController.signal.aborted || this.stopped) {
						return;
					}

					const normalized = normalizeEventPayload(event);
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
