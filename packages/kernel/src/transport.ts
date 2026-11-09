import { deserializeError, serializeError, type SerializedError } from "./errors";
import { wrapMessagePort, type KernelPort } from "./ports";

export type TransportOrigin =
	| { readonly process: "main" }
	| { readonly process: "renderer"; readonly windowId: string };

export interface SendOptions {
	/** From main: deliver to this window only. */
	readonly toWindow?: string;
	/** From main: deliver to every window except this one. */
	readonly exceptWindow?: string;
}

/**
 * The kernel's process boundary. Renderers make requests to main; both sides
 * send fire-and-forget messages (main broadcasts to every window unless
 * targeted). Payloads must be structured-cloneable. Request handlers may throw
 * a `KernelError`; anything else reaches the caller as a scrubbed INTERNAL error.
 */
export interface KernelTransport {
	readonly origin: TransportOrigin;
	request(channel: string, payload: unknown): Promise<unknown>;
	handle(
		channel: string,
		handler: (payload: unknown, from: TransportOrigin) => unknown,
	): () => void;
	send(channel: string, payload: unknown, options?: SendOptions): void;
	on(channel: string, listener: (payload: unknown, from: TransportOrigin) => void): () => void;
	/** Resolves once every in-flight delivery has landed (immediate for real IPC). */
	flush?(): Promise<void>;
	/** Renderer: hands main one end of a new message channel. */
	openPort?(channel: string, payload: unknown, port: MessagePort): void;
	/** Main: receives the ports renderers open. */
	onPort?(
		handler: (channel: string, payload: unknown, port: KernelPort, from: TransportOrigin) => void,
	): () => void;
}

export type TransportResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: SerializedError };

/** Runs a request handler and converts the outcome into a cloneable result envelope. */
export async function runRequestHandler(
	handler: ((payload: unknown, from: TransportOrigin) => unknown) | undefined,
	channel: string,
	payload: unknown,
	from: TransportOrigin,
	onUnexpectedError?: (error: unknown) => void,
): Promise<TransportResult> {
	if (!handler) {
		return { ok: false, error: { code: "NOT_FOUND", message: `No handler for "${channel}".` } };
	}
	try {
		return { ok: true, value: await handler(payload, from) };
	} catch (error) {
		const serialized = serializeError(error);
		if (serialized.code === "INTERNAL") onUnexpectedError?.(error);
		return { ok: false, error: serialized };
	}
}

export function unwrapTransportResult(result: TransportResult): unknown {
	if (result.ok) return result.value;
	throw deserializeError(result.error);
}

type Listener = (payload: unknown, from: TransportOrigin) => void;

class ListenerMap {
	readonly #listeners = new Map<string, Set<Listener>>();

	add(channel: string, listener: Listener): () => void {
		const set = this.#listeners.get(channel) ?? new Set();
		set.add(listener);
		this.#listeners.set(channel, set);
		return () => set.delete(listener);
	}

	deliver(channel: string, payload: unknown, from: TransportOrigin): void {
		for (const listener of [...(this.#listeners.get(channel) ?? [])]) listener(payload, from);
	}
}

export interface LinkedTransports {
	readonly main: KernelTransport;
	connectRenderer(windowId: string): KernelTransport;
}

/**
 * In-memory transports for one main and any number of renderers, used in
 * browser mode and tests. Deliveries are asynchronous and payloads are cloned,
 * matching real IPC semantics.
 */
export function createLinkedTransports(): LinkedTransports {
	const pending = new Set<Promise<void>>();
	const deliver = (fn: () => void | Promise<void>): void => {
		const promise = Promise.resolve()
			.then(fn)
			.finally(() => pending.delete(promise));
		pending.add(promise);
	};
	const flush = async (): Promise<void> => {
		while (pending.size > 0) await Promise.allSettled([...pending]);
	};

	const mainOrigin: TransportOrigin = { process: "main" };
	const mainHandlers = new Map<string, (payload: unknown, from: TransportOrigin) => unknown>();
	let portHandler:
		| ((channel: string, payload: unknown, port: KernelPort, from: TransportOrigin) => void)
		| undefined;
	const mainListeners = new ListenerMap();
	const renderers = new Map<string, ListenerMap>();

	const main: KernelTransport = {
		origin: mainOrigin,
		request: () => Promise.reject(new Error("Main cannot make requests to renderers.")),
		handle(channel, handler) {
			mainHandlers.set(channel, handler);
			return () => {
				if (mainHandlers.get(channel) === handler) mainHandlers.delete(channel);
			};
		},
		send(channel, payload, options = {}) {
			const cloned = structuredClone(payload);
			for (const [windowId, listeners] of renderers) {
				if (options.toWindow !== undefined && options.toWindow !== windowId) continue;
				if (options.exceptWindow === windowId) continue;
				deliver(() => listeners.deliver(channel, structuredClone(cloned), mainOrigin));
			}
		},
		on: (channel, listener) => mainListeners.add(channel, listener),
		flush,
		onPort(handler) {
			portHandler = handler;
			return () => {
				if (portHandler === handler) portHandler = undefined;
			};
		},
	};

	return {
		main,
		connectRenderer(windowId) {
			const origin: TransportOrigin = { process: "renderer", windowId };
			const listeners = new ListenerMap();
			renderers.set(windowId, listeners);
			return {
				origin,
				async request(channel, payload) {
					const cloned = structuredClone(payload);
					await Promise.resolve();
					const result = await runRequestHandler(
						mainHandlers.get(channel),
						channel,
						cloned,
						origin,
					);
					return unwrapTransportResult(structuredClone(result));
				},
				handle: () => {
					throw new Error("Renderers do not handle requests.");
				},
				send(channel, payload) {
					const cloned = structuredClone(payload);
					deliver(() => mainListeners.deliver(channel, cloned, origin));
				},
				on: (channel, listener) => listeners.add(channel, listener),
				flush,
				openPort(channel, payload, port) {
					const cloned = structuredClone(payload);
					deliver(() => {
						const wrapped = wrapMessagePort(port);
						if (portHandler) portHandler(channel, cloned, wrapped, origin);
						else wrapped.close();
					});
				},
			};
		},
	};
}
