import { KernelError } from "./errors";
import type { TransportOrigin } from "./transport";

/** Main's end of a port a renderer opened: a stream of structured-cloneable messages. */
export interface KernelPort {
	postMessage(data: unknown): void;
	onMessage(listener: (data: unknown) => void): () => void;
	/** Fires once, when either end closes or the renderer goes away. */
	onClose(listener: () => void): () => void;
	close(): void;
}

export interface PortCaller {
	readonly pluginId: string;
	readonly windowId: string;
}

/** Handles one port; `args` are the opener's, unvalidated. */
export type PortHandler = (port: KernelPort, args: unknown, caller: PortCaller) => void;

/** The platform port (DOM, Node worker or Electron main) a KernelPort is built on. */
export interface RawPort {
	start(): void;
	postMessage(data: unknown): void;
	close(): void;
	onMessage(listener: (data: unknown) => void): void;
	onClose(listener: () => void): void;
}

/**
 * Builds a KernelPort on a platform port. The port starts at once, so a close
 * is noticed even by a handler that never reads, but messages are held until
 * the first `onMessage` listener: handlers often subscribe after an await, and
 * a started platform port drops whatever arrives while it has no listener.
 */
export function adaptPort(raw: RawPort): KernelPort {
	const messageListeners = new Set<(data: unknown) => void>();
	const closeListeners = new Set<() => void>();
	let held: unknown[] | undefined = [];
	let closed = false;
	const dispatch = (data: unknown) => {
		for (const listener of [...messageListeners]) listener(data);
	};
	const release = () => {
		if (!held || messageListeners.size === 0) return;
		const queued = held;
		held = undefined;
		for (const data of queued) dispatch(data);
	};
	const fireClose = () => {
		if (closed) return;
		closed = true;
		for (const listener of [...closeListeners]) listener();
	};
	raw.onMessage((data) => (held ? held.push(data) : dispatch(data)));
	raw.onClose(fireClose);
	raw.start();
	return {
		postMessage: (data) => {
			if (!closed) raw.postMessage(data);
		},
		onMessage(listener) {
			messageListeners.add(listener);
			if (held?.length === 0) held = undefined;
			// Deferred so the subscriber has its unsubscribe in hand before held messages land.
			else if (held) queueMicrotask(release);
			return () => messageListeners.delete(listener);
		},
		onClose(listener) {
			closeListeners.add(listener);
			return () => closeListeners.delete(listener);
		},
		close() {
			raw.close();
			fireClose();
		},
	};
}

/** Wraps a DOM (or Node worker) MessagePort as a KernelPort, starting it. */
export function wrapMessagePort(port: MessagePort): KernelPort {
	return adaptPort({
		start: () => port.start(),
		postMessage: (data) => port.postMessage(data),
		close: () => port.close(),
		onMessage: (listener) => port.addEventListener("message", (event) => listener(event.data)),
		onClose: (listener) => port.addEventListener("close", listener),
	});
}

/**
 * Main's port handlers, by qualified name (`<plugin>/<name>`). A renderer
 * plugin can only open its own plugin's ports; a port nobody handles closes
 * at once.
 */
export class PortRegistry {
	readonly #handlers = new Map<string, PortHandler>();

	handle(qualifiedName: string, handler: PortHandler): () => void {
		if (this.#handlers.has(qualifiedName)) {
			throw new KernelError("CONFLICT", `Port "${qualifiedName}" already has a handler.`);
		}
		this.#handlers.set(qualifiedName, handler);
		return () => {
			if (this.#handlers.get(qualifiedName) === handler) this.#handlers.delete(qualifiedName);
		};
	}

	dispatch(qualifiedName: string, args: unknown, port: KernelPort, from: TransportOrigin): void {
		const handler = this.#handlers.get(qualifiedName);
		const slash = qualifiedName.indexOf("/");
		if (!handler || from.process !== "renderer" || slash <= 0) {
			port.close();
			return;
		}
		try {
			handler(port, args, { pluginId: qualifiedName.slice(0, slash), windowId: from.windowId });
		} catch {
			port.close();
		}
	}
}
