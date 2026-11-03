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

/** Wraps a DOM (or Node worker) MessagePort as a KernelPort, starting it. */
export function wrapMessagePort(port: MessagePort): KernelPort {
	const closeListeners = new Set<() => void>();
	let closed = false;
	const fireClose = () => {
		if (closed) return;
		closed = true;
		for (const listener of [...closeListeners]) listener();
	};
	port.addEventListener("close", fireClose);
	port.start();
	return {
		postMessage: (data) => {
			if (!closed) port.postMessage(data);
		},
		onMessage(listener) {
			const handler = (event: MessageEvent) => listener(event.data);
			port.addEventListener("message", handler);
			return () => port.removeEventListener("message", handler);
		},
		onClose(listener) {
			closeListeners.add(listener);
			return () => closeListeners.delete(listener);
		},
		close() {
			port.close();
			fireClose();
		},
	};
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
