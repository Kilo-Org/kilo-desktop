import { z } from "zod";

import { defineMethod } from "../channel-map.js";
import type { ThemeAppearance } from "../types/sdk.js";
import { CommandRegistry } from "./command-registry.js";
import { ContributionRegistry } from "./contribution-registry.js";
import { FeatureRouter } from "./feature-router.js";
import { createStaticNavigation } from "./navigation.js";
import { StateBroker } from "./state-broker.js";
import { ToolRegistry } from "./tool-registry.js";
import type { ShellDelegates } from "./create-sdk.js";

export const noop = () => {};

export const testChannels = {
	list: defineMethod(z.undefined(), z.array(z.unknown())),
	greet: defineMethod(z.object({ name: z.string() }), z.string()),
	yes: defineMethod(z.undefined(), z.string()),
	create: defineMethod(z.object({ title: z.string().min(1) }), z.string()),
	local: defineMethod(z.undefined(), z.string()),
	fail: defineMethod(z.undefined(), z.unknown()),
} as const;

export function makeServices(featureRouter?: FeatureRouter) {
	const router = featureRouter ?? new FeatureRouter();
	const appearance: ThemeAppearance = {
		mode: "light",
		themeId: "anaconda",
		terminal: null,
		shiki: "pierre-light",
	};
	const shellDelegates: ShellDelegates = {
		notifications: {
			show: async () => ({ delivered: true }),
			setBadge: async () => ({ delivered: true }),
		},
		telemetry: { track: async () => {} },
		theme: {
			subscribe: (fn) => {
				fn();
				return noop;
			},
			appearance: () => appearance,
		},
		auth: {
			subscribe: (fn) => {
				fn({ status: "anonymous" });
				return noop;
			},
			peek: () => ({ status: "anonymous" }),
			getSession: async () => ({ status: "anonymous" }),
			refresh: async () => ({ status: "anonymous" }),
			login: async () => ({ status: "anonymous" }),
			logout: async () => ({ status: "anonymous" }),
		},
		featureFlags: {
			getAllFlags: async () => ({}),
			subscribe: (fn) => {
				fn({});
				return noop;
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
			onPaneWindowChanged: () => noop,
		},
		fs: {
			readFile: async (_featureId: string, _path: string) => "",
			writeFile: async () => undefined,
			exists: async () => false,
			mkdir: async () => undefined,
			readdir: async () => [],
			remove: async () => undefined,
		},
		navigation: createStaticNavigation(),
	};

	return {
		stateBroker: new StateBroker(),
		contributionRegistry: new ContributionRegistry(),
		commandRegistry: new CommandRegistry(),
		toolRegistry: new ToolRegistry(),
		featureRouter: router,
		shellDelegates,
	};
}
