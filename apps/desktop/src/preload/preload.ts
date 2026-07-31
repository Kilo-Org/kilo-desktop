import { contextBridge, ipcRenderer } from "electron";

import {
	ipcMethods,
	type DesktopApi,
	type IpcMethodChannel,
} from "@anaconda-agentic-desktop/contracts";

const invoke = ((channel: IpcMethodChannel, input?: unknown) => {
	if (!(channel in ipcMethods)) {
		throw new Error("Unknown IPC method channel.");
	}
	return ipcRenderer.invoke(channel, input);
}) as DesktopApi["invoke"];

const desktopApi: DesktopApi = {
	invoke,
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
