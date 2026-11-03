// Wire Sentry's renderer→main IPC bridge (ipcRenderer-based). Paired with
// `ipcMode: IPCMode.Classic` in the main process (`platform/sentry.ts`) so
// renderer telemetry flows over `ipcRenderer` rather than the `sentry-ipc://`
// fetch protocol, which the app's strict CSP `connect-src` refuses.
import "@sentry/electron/preload";

import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { KernelBridge, KeyboardPlatform, RendererWindow } from "@kilo-desktop/kernel";

import { readWindowArguments } from "./window-arguments";

const KERNEL_IPC = {
	request: "kernel:request",
	message: "kernel:message",
	event: "kernel:event",
	port: "kernel:port",
} as const;
const SHORTCUT_CHANNEL = "shortcuts:triggered";

function platformOf(nodePlatform: string): KeyboardPlatform {
	if (nodePlatform === "darwin") return "mac";
	if (nodePlatform === "win32") return "windows";
	return "linux";
}

const window: RendererWindow = readWindowArguments(process.argv);

const kernelBridge: KernelBridge = {
	window,
	platform: platformOf(process.platform),
	request: (channel, payload) => ipcRenderer.invoke(KERNEL_IPC.request, { channel, payload }),
	send: (channel, payload) => ipcRenderer.send(KERNEL_IPC.message, { channel, payload }),
	on(listener) {
		const handler = (_event: Electron.IpcRendererEvent, message: unknown) => {
			const { channel, payload } = (message ?? {}) as { channel?: unknown; payload?: unknown };
			if (typeof channel === "string") listener(channel, payload);
		};
		ipcRenderer.on(KERNEL_IPC.event, handler);
		return () => ipcRenderer.removeListener(KERNEL_IPC.event, handler);
	},
	onShortcut(listener) {
		const handler = (_event: Electron.IpcRendererEvent, message: unknown) => {
			const chord = (message as { chord?: unknown } | null)?.chord;
			if (typeof chord === "string") listener(chord);
		};
		ipcRenderer.on(SHORTCUT_CHANNEL, handler);
		return () => ipcRenderer.removeListener(SHORTCUT_CHANNEL, handler);
	},
	getPathForFile(file) {
		return webUtils.getPathForFile(file) || null;
	},
};

contextBridge.exposeInMainWorld("kernelBridge", kernelBridge);

// Ports the renderer posts to its own window go on to main (contextBridge can't carry them).
// The key matches the kernel's KERNEL_PORT_MESSAGE; the preload imports no kernel code.
const page = globalThis as unknown as Window;
page.addEventListener("message", (event: MessageEvent<unknown>) => {
	if (event.source !== page || event.origin !== page.location.origin) return;
	const request = (event.data as Record<string, unknown> | null)?.[KERNEL_IPC.port];
	if (!request || typeof request !== "object" || event.ports.length !== 1) return;
	const { channel, payload } = request as { channel?: unknown; payload?: unknown };
	if (typeof channel !== "string") return;
	ipcRenderer.postMessage(KERNEL_IPC.port, { channel, payload }, [event.ports[0]!]);
});
