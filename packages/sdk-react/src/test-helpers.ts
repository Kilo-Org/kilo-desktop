import { createStaticNavigation } from "@anaconda-agentic-desktop/feature-sdk";

import type { ShellDelegates, ThemeAppearance } from "@anaconda-agentic-desktop/feature-sdk";

const DEFAULT_APPEARANCE: ThemeAppearance = {
	mode: "light",
	themeId: "anaconda",
	terminal: null,
	shiki: "pierre-light",
};

function notImplemented(method: string): (...args: never[]) => Promise<never> {
	return async () => {
		throw new Error(`[test] ${method} is not implemented in this test.`);
	};
}

/** Minimal host delegates for exercising the provider and hooks in tests. */
export function createTestShellDelegates(): ShellDelegates {
	return {
		notifications: {
			show: async () => ({ delivered: true }),
			setBadge: async () => ({ delivered: true }),
		},
		telemetry: { track: async () => {} },
		theme: {
			subscribe(fn) {
				fn();
				return () => {};
			},
			appearance: () => DEFAULT_APPEARANCE,
		},
		auth: {
			subscribe(fn) {
				fn({ status: "anonymous" });
				return () => {};
			},
			peek: () => ({ status: "anonymous" }),
			getSession: async () => ({ status: "anonymous" }),
			refresh: async () => ({ status: "anonymous" }),
			login: async () => ({ status: "anonymous" }),
			logout: async () => ({ status: "anonymous" }),
		},
		featureFlags: {
			getAllFlags: async () => ({}),
			subscribe(fn) {
				fn({});
				return () => {};
			},
			peek: () => ({}),
		},
		shell: {
			canPickDirectories: true,
			canPopOutPanes: true,
			windowRole: "main",
			openExternal: async () => ({ opened: true }),
			copyText: async () => undefined,
			showItemInFolder: async () => ({ revealed: true }),
			showOpenDialog: async () => ({ canceled: true, paths: [] }),
			getPathForFile: () => null,
			openPaneWindow: async () => ({ opened: true }),
			listPaneWindows: async () => [],
			focusPaneWindow: async () => ({ focused: true }),
			dockPaneWindow: async () => ({ docked: true }),
			syncPaneWindows: async () => undefined,
			onPaneWindowChanged: () => () => {},
		},
		fs: {
			readFile: notImplemented("sdk.fs.readFile"),
			writeFile: notImplemented("sdk.fs.writeFile"),
			exists: notImplemented("sdk.fs.exists"),
			mkdir: notImplemented("sdk.fs.mkdir"),
			readdir: notImplemented("sdk.fs.readdir"),
			remove: notImplemented("sdk.fs.remove"),
		},
		navigation: createStaticNavigation(),
	};
}
