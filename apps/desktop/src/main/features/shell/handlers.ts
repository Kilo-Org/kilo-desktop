import type { IpcHandlers } from "@kilo-desktop/contracts";

import type { ElectronShell } from "../../platform/ElectronShell.js";
import type { ElectronWindow } from "../../platform/ElectronWindow.js";

export function createShellHandlers(
	electronShell: ElectronShell,
	electronWindow: ElectronWindow,
	isDevelopment: boolean,
): Pick<
	IpcHandlers,
	| "shell:open-external"
	| "shell:copy-text"
	| "shell:show-item-in-folder"
	| "shell:show-open-dialog"
	| "shell:open-pane-window"
	| "shell:list-pane-windows"
	| "shell:focus-pane-window"
	| "shell:dock-pane-window"
	| "shell:sync-pane-windows"
> {
	return {
		"shell:open-external": async ({ url }) => ({
			opened: await electronShell.openExternal(url),
		}),
		"shell:copy-text": ({ text }) => {
			electronShell.copyText(text);
		},
		"shell:show-item-in-folder": async ({ path }) => ({
			revealed: electronShell.showItemInFolder(path),
		}),
		"shell:show-open-dialog": (input) => electronShell.showOpenDialog(input),
		"shell:open-pane-window": (input) => electronWindow.openPaneWindow(input, isDevelopment),
		"shell:list-pane-windows": ({ pluginId }) => electronWindow.listPaneWindows(pluginId),
		"shell:focus-pane-window": (input) => electronWindow.focusPaneWindow(input),
		"shell:dock-pane-window": (input) => {
			const exists = electronWindow
				.listPaneWindows(input.pluginId)
				.some((window) => window.sessionId === input.sessionId && window.paneId === input.paneId);
			if (exists) setTimeout(() => electronWindow.dockPaneWindow(input), 0);
			return { docked: exists };
		},
		"shell:sync-pane-windows": ({ pluginId, activeSessionId }) => {
			electronWindow.syncPaneWindows(pluginId, activeSessionId);
		},
	} satisfies Pick<
		IpcHandlers,
		| "shell:open-external"
		| "shell:copy-text"
		| "shell:show-item-in-folder"
		| "shell:show-open-dialog"
		| "shell:open-pane-window"
		| "shell:list-pane-windows"
		| "shell:focus-pane-window"
		| "shell:dock-pane-window"
		| "shell:sync-pane-windows"
	>;
}
