// Wire Sentry's renderer→main IPC bridge (ipcRenderer-based). Paired with
// `ipcMode: IPCMode.Classic` in the main process (`platform/sentry.ts`) so
// renderer telemetry flows over `ipcRenderer` rather than the `sentry-ipc://`
// fetch protocol, which the app's strict CSP `connect-src` refuses.
import "@sentry/electron/preload";

import { contextBridge, ipcRenderer, webUtils } from "electron";

import {
	featurePortPayload,
	ipcEvents,
	ipcMessages,
	ipcMethods,
	type DesktopApi,
	type IpcEventChannel,
	type IpcEventPayload,
	type IpcMethodChannel,
	type IpcMessageChannel,
	type IpcMessagePayload,
} from "@kilo-desktop/contracts";

window.addEventListener("message", (event: MessageEvent<unknown>) => {
	if (event.source !== window || event.origin !== window.location.origin) return;
	const parsed = featurePortPayload.safeParse(event.data);
	if (!parsed.success || event.ports.length !== 1) return;
	ipcRenderer.postMessage("feature:port", parsed.data, [event.ports[0]!]);
});

const invoke = ((channel: IpcMethodChannel, input?: unknown) => {
	if (!(channel in ipcMethods)) {
		throw new Error("Unknown IPC method channel.");
	}
	return ipcRenderer.invoke(channel, input);
}) as DesktopApi["invoke"];

function getWindowArgument(name: string): string | undefined {
	const prefix = `${name}=`;
	return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const desktopApi: DesktopApi = {
	windowRole: getWindowArgument("--kilo-window-role") === "pane" ? "pane" : "main",
	getPathForFile(file) {
		const resolved = webUtils.getPathForFile(file);
		return resolved || null;
	},
	invoke,
	send: <TChannel extends IpcMessageChannel>(
		channel: TChannel,
		payload: IpcMessagePayload<TChannel>,
	) => {
		if (!(channel in ipcMessages)) {
			throw new Error("Unknown IPC message channel.");
		}
		const parsedPayload = ipcMessages[channel].payload.parse(payload);
		ipcRenderer.send(channel, parsedPayload);
	},
	on: <TChannel extends IpcEventChannel>(
		channel: TChannel,
		listener: (payload: IpcEventPayload<TChannel>) => void,
	) => {
		if (!(channel in ipcEvents)) {
			throw new Error("Unknown IPC event channel.");
		}
		const handler = (_event: Electron.IpcRendererEvent, rawPayload: unknown) => {
			const result = ipcEvents[channel].payload.safeParse(rawPayload);
			if (result.success) listener(result.data as IpcEventPayload<TChannel>);
		};
		ipcRenderer.on(channel, handler);
		return () => {
			ipcRenderer.removeListener(channel, handler);
		};
	},
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
