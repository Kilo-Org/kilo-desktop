import type { KeyboardPlatform } from "./keybindings";
import {
	unwrapTransportResult,
	type KernelTransport,
	type TransportOrigin,
	type TransportResult,
} from "./transport";
import type { RendererWindow } from "./window";

/**
 * What a desktop preload exposes to the renderer (`window.kernelBridge`): the
 * window's identity and three generic channels to main. Everything else the
 * kernel does rides on top of these.
 */
export interface KernelBridge {
	readonly window: RendererWindow;
	readonly platform: KeyboardPlatform;
	request(channel: string, payload: unknown): Promise<TransportResult>;
	send(channel: string, payload: unknown): void;
	on(listener: (channel: string, payload: unknown) => void): () => void;
	/** Chords captured by main's shortcut capture for this window. */
	onShortcut(listener: (chord: string) => void): () => void;
	getPathForFile(file: File): string | null;
}

/** The key of the window message a renderer posts to hand the preload a port for main. */
export const KERNEL_PORT_MESSAGE = "kernel:port";

/** The renderer side of the kernel transport over a preload bridge. */
export function createBridgeTransport(bridge: KernelBridge): KernelTransport {
	const listeners = new Map<string, Set<(payload: unknown, from: TransportOrigin) => void>>();
	const mainOrigin: TransportOrigin = { process: "main" };
	bridge.on((channel, payload) => {
		for (const listener of [...(listeners.get(channel) ?? [])]) listener(payload, mainOrigin);
	});
	return {
		origin: { process: "renderer", windowId: bridge.window.id },
		request: async (channel, payload) =>
			unwrapTransportResult(await bridge.request(channel, payload)),
		handle: () => {
			throw new Error("Renderers do not handle requests.");
		},
		send: (channel, payload) => bridge.send(channel, payload),
		// The preload forwards ports posted to its own window; contextBridge can't carry them.
		openPort(channel, payload, port) {
			window.postMessage({ [KERNEL_PORT_MESSAGE]: { channel, payload } }, window.location.origin, [
				port,
			]);
		},
		on(channel, listener) {
			const set = listeners.get(channel) ?? new Set();
			set.add(listener);
			listeners.set(channel, set);
			return () => set.delete(listener);
		},
	};
}
