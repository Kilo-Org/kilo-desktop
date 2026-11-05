import {
	ipcMain as electronIpcMain,
	type IpcMain,
	type IpcMainEvent,
	type IpcMainInvokeEvent,
	type MessagePortMain,
	type WebContents,
} from "electron";
import { z } from "zod";

import {
	adaptPort,
	runRequestHandler,
	type KernelPort,
	type KernelTransport,
	type SendOptions,
	type TransportOrigin,
	type TransportResult,
} from "@kilo-desktop/kernel";

import { isTrustedIpcSender } from "../platform/ElectronSecurity.js";

/** The only IPC channels the kernel uses; everything else rides inside them. */
export const KERNEL_IPC = {
	request: "kernel:request",
	message: "kernel:message",
	event: "kernel:event",
	port: "kernel:port",
} as const;

type PortHandler = (
	channel: string,
	payload: unknown,
	port: KernelPort,
	from: TransportOrigin,
) => void;

/** Main's end of a renderer-opened channel, as the kernel sees it. */
export function wrapPortMain(port: MessagePortMain): KernelPort {
	return adaptPort({
		start: () => port.start(),
		postMessage: (data) => port.postMessage(data),
		close: () => port.close(),
		onMessage: (listener) => port.on("message", (event) => listener(event.data)),
		onClose: (listener) => port.on("close", listener),
	});
}

const envelope = z.object({ channel: z.string().min(1), payload: z.unknown().optional() });

type Handler = (payload: unknown, from: TransportOrigin) => unknown;
type Listener = (payload: unknown, from: TransportOrigin) => void;

type SenderEvent = Pick<IpcMainEvent | IpcMainInvokeEvent, "sender" | "senderFrame">;

const denied: TransportResult = {
	ok: false,
	error: { code: "PERMISSION_DENIED", message: "The IPC sender is not trusted." },
};

/**
 * Main-process side of the kernel transport over Electron IPC. Only windows
 * the app created (attached by id) on the trusted app origin may talk to the
 * kernel; each request and message is stamped with its window id.
 */
export class ElectronKernelTransport implements KernelTransport {
	readonly origin: TransportOrigin = { process: "main" };
	readonly #ipcMain: IpcMain;
	readonly #handlers = new Map<string, Handler>();
	readonly #listeners = new Map<string, Set<Listener>>();
	readonly #windows = new Map<string, WebContents>();
	#portHandler: PortHandler | undefined;
	readonly #onUnexpectedError: ((error: unknown) => void) | undefined;

	constructor(ipcMain: IpcMain = electronIpcMain, onUnexpectedError?: (error: unknown) => void) {
		this.#ipcMain = ipcMain;
		this.#onUnexpectedError = onUnexpectedError;
	}

	install(): () => void {
		this.#ipcMain.handle(KERNEL_IPC.request, async (event, raw: unknown) => {
			const from = this.#originOf(event);
			const parsed = envelope.safeParse(raw);
			if (!from || !parsed.success) return denied;
			return runRequestHandler(
				this.#handlers.get(parsed.data.channel),
				parsed.data.channel,
				parsed.data.payload,
				from,
				this.#onUnexpectedError,
			);
		});
		const onMessage = (event: IpcMainEvent, raw: unknown) => {
			const from = this.#originOf(event);
			const parsed = envelope.safeParse(raw);
			if (!from || !parsed.success) return;
			for (const listener of [...(this.#listeners.get(parsed.data.channel) ?? [])]) {
				listener(parsed.data.payload, from);
			}
		};
		this.#ipcMain.on(KERNEL_IPC.message, onMessage);
		const onPort = (event: IpcMainEvent, raw: unknown) => {
			const from = this.#originOf(event);
			const parsed = envelope.safeParse(raw);
			const [port] = event.ports;
			if (!port) return;
			if (!from || !parsed.success || !this.#portHandler) {
				port.close();
				return;
			}
			this.#portHandler(parsed.data.channel, parsed.data.payload, wrapPortMain(port), from);
		};
		this.#ipcMain.on(KERNEL_IPC.port, onPort);
		return () => {
			this.#ipcMain.removeHandler(KERNEL_IPC.request);
			this.#ipcMain.removeListener(KERNEL_IPC.message, onMessage);
			this.#ipcMain.removeListener(KERNEL_IPC.port, onPort);
		};
	}

	attachWindow(windowId: string, contents: WebContents): void {
		this.#windows.set(windowId, contents);
	}

	detachWindow(windowId: string): void {
		this.#windows.delete(windowId);
	}

	windowIdOf(contentsId: number): string | undefined {
		for (const [windowId, contents] of this.#windows) {
			if (contents.id === contentsId) return windowId;
		}
		return undefined;
	}

	contentsOf(windowId: string): WebContents | undefined {
		return this.#windows.get(windowId);
	}

	request(): Promise<unknown> {
		return Promise.reject(new Error("Main cannot make requests to renderers."));
	}

	handle(channel: string, handler: Handler): () => void {
		this.#handlers.set(channel, handler);
		return () => {
			if (this.#handlers.get(channel) === handler) this.#handlers.delete(channel);
		};
	}

	send(channel: string, payload: unknown, options: SendOptions = {}): void {
		for (const [windowId, contents] of this.#windows) {
			if (options.toWindow !== undefined && options.toWindow !== windowId) continue;
			if (options.exceptWindow === windowId || contents.isDestroyed()) continue;
			contents.send(KERNEL_IPC.event, { channel, payload });
		}
	}

	onPort(handler: PortHandler): () => void {
		this.#portHandler = handler;
		return () => {
			if (this.#portHandler === handler) this.#portHandler = undefined;
		};
	}

	on(channel: string, listener: Listener): () => void {
		const set = this.#listeners.get(channel) ?? new Set();
		set.add(listener);
		this.#listeners.set(channel, set);
		return () => set.delete(listener);
	}

	#originOf(event: SenderEvent): TransportOrigin | undefined {
		if (!isTrustedIpcSender(event as IpcMainInvokeEvent)) return undefined;
		const windowId = this.windowIdOf(event.sender.id);
		return windowId === undefined ? undefined : { process: "renderer", windowId };
	}
}
