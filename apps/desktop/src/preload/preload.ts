import { contextBridge, ipcRenderer, webUtils } from "electron";

import {
	ipcEvents,
	ipcMessages,
	ipcMethods,
	type DesktopApi,
	type IpcEventChannel,
	type IpcEventPayload,
	type IpcMethodChannel,
	type IpcMessageChannel,
	type IpcMessagePayload,
} from "@anaconda-agentic-desktop/contracts";

const invoke = ((channel: IpcMethodChannel, input?: unknown) => {
	if (!(channel in ipcMethods)) {
		throw new Error("Unknown IPC method channel.");
	}
	return ipcRenderer.invoke(channel, input);
}) as DesktopApi["invoke"];

const desktopApi: DesktopApi = {
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
