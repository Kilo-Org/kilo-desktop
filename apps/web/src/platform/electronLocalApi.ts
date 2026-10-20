import {
	LocalApiError,
	type DesktopApi,
	type InvokeArguments,
	type IpcMethodChannel,
	type IpcMethodOutput,
	type LocalApi,
} from "@kilo-desktop/contracts";

export function createElectronLocalApi(bridge: DesktopApi): LocalApi {
	const invoke = async <C extends IpcMethodChannel>(
		channel: C,
		...args: InvokeArguments<C>
	): Promise<IpcMethodOutput<C>> => {
		const result = await bridge.invoke(channel, ...args);
		if (!result.ok) {
			throw new LocalApiError(result.error.code, result.error.message);
		}
		return result.value;
	};

	return {
		theme: {
			sync: (input) => invoke("theme:sync", input),
		},
		shell: {
			canPickDirectories: true,
			canPopOutPanes: true,
			canShowLogFile: true,
			windowRole: bridge.windowRole,
			openExternal: (input) => invoke("shell:open-external", input),
			copyText: (input) => invoke("shell:copy-text", input),
			showItemInFolder: (input) => invoke("shell:show-item-in-folder", input),
			showLogFile: () => invoke("shell:show-log-file"),
			getLogFilePath: () => invoke("shell:get-log-file-path"),
			showOpenDialog: (input) => invoke("shell:show-open-dialog", input),
			getPathForFile: (file) => bridge.getPathForFile(file),
			openPaneWindow: (input) => invoke("shell:open-pane-window", input),
			listPaneWindows: (input) => invoke("shell:list-pane-windows", input),
			focusPaneWindow: (input) => invoke("shell:focus-pane-window", input),
			dockPaneWindow: (input) => invoke("shell:dock-pane-window", input),
			syncPaneWindows: (input) => invoke("shell:sync-pane-windows", input),
			focusMainWindow: () => invoke("shell:focus-main-window"),
			onPaneWindowChanged: (listener) => bridge.on("shell:pane-window-changed", listener),
			onNavigate: (listener) => bridge.on("shell:navigate", listener),
		},
		shortcuts: {
			sync: ({ bindings, recording }) =>
				bridge.send("shortcuts:sync", { bindings: [...bindings], recording }),
			onTriggered: (listener) => bridge.on("shortcuts:triggered", listener),
		},
		notifications: {
			show: (input) => invoke("notifications:show", input),
			setBadge: (input) => invoke("notifications:set-badge", input),
		},
		fs: {
			readFile: (input) => invoke("fs:read-file", input),
			writeFile: (input) => invoke("fs:write-file", input),
			exists: (input) => invoke("fs:exists", input),
			mkdir: (input) => invoke("fs:mkdir", input),
			readdir: (input) => invoke("fs:readdir", input),
			remove: (input) => invoke("fs:remove", input),
		},
		auth: {
			getSession: () => invoke("auth:get-session"),
			refresh: () => invoke("auth:refresh"),
			login: () => invoke("auth:login"),
			logout: () => invoke("auth:logout"),
			onChanged: (listener) => bridge.on("auth:changed", listener),
		},
		featureFlags: {
			getAllFlags: () => invoke("feature-flag:get-all"),
			onChanged: (listener) => bridge.on("feature-flag:changed", listener),
		},
		telemetry: {
			track: async (input) => {
				await invoke("telemetry:track", input);
			},
		},
		updates: {
			getState: () => invoke("updates:get-state"),
			check: () => invoke("updates:check"),
			setTrack: (track) => invoke("updates:set-track", track),
			install: () => invoke("updates:install"),
			onChanged: (listener) => bridge.on("updates:state-changed", listener),
		},
	};
}
